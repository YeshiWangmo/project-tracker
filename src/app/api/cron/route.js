import { NextResponse } from "next/server";
import connectMongo from "../../../lib/mongodb";
import Tracker from "../../../models/Tracker";

const APP_TIME_ZONE = "Asia/Thimphu";

function getTimeZoneDateParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
    day: Number(parts.find((part) => part.type === "day")?.value),
  };
}

export async function GET(req) {
  try {
    const authHeader = req.headers.get("authorization");
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    await connectMongo();
    const sheets = await Tracker.find({});

    let emailsSent = 0;
    const todayParts = getTimeZoneDateParts(new Date(), APP_TIME_ZONE);
    const todayUtc = Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day);

    const appBaseUrl = "https://project-tracker-nine-phi.vercel.app";
    const host = req.headers.get("host") || "localhost:3000";
    const protocol = host.includes("localhost") ? "http" : "https";
    const senderBaseUrl = `${protocol}://${host}`;

    const extractEmailsWithRoles = (sheet, row) => {
      const recipients = [];
      const seenEmails = new Set();

      for (const col of sheet.emailCols || []) {
        const emailString = row.emails?.[col.id];
        if (typeof emailString !== "string" || emailString.trim() === "") continue;

        let role = "receiver";
        if (col?.role === "payer" || (col?.title && col.title.toLowerCase().includes("payer"))) {
          role = "payer";
        }

        const splitEmails = emailString
          .split(/[;,]/)
          .map((email) => email.trim())
          .filter((email) => email.includes("@"));

        for (const address of splitEmails) {
          const lowerAddress = address.toLowerCase();
          if (!seenEmails.has(lowerAddress)) {
            seenEmails.add(lowerAddress);
            recipients.push({ address, role });
          }
        }
      }

      return recipients;
    };

    const getDateDiffDays = (dateValue) => {
      const value = typeof dateValue === "string" ? dateValue.trim() : "";
      if (!value) return null;

      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const [year, month, day] = value.split("-").map(Number);
        const targetUtc = Date.UTC(year, month - 1, day);
        return Math.round((targetUtc - todayUtc) / (1000 * 60 * 60 * 24));
      }

      const targetDate = new Date(dateValue);
      if (Number.isNaN(targetDate.getTime())) return null;
      const targetParts = getTimeZoneDateParts(targetDate, APP_TIME_ZONE);
      const targetUtc = Date.UTC(targetParts.year, targetParts.month - 1, targetParts.day);
      return Math.round((targetUtc - todayUtc) / (1000 * 60 * 60 * 24));
    };

    for (const sheet of sheets) {
      const safeRows = Array.isArray(sheet.rows) ? sheet.rows : [];
      let sheetChanged = false;

      for (const row of safeRows) {
        const emailsWithRoles = extractEmailsWithRoles(sheet, row);
        if (emailsWithRoles.length === 0) continue;

        for (const col of sheet.dueTypes || []) {
          const status = row.statuses?.[col.id];
          const dueDate = row.dueDates?.[col.id];

          if (!dueDate || status === "Cleared") continue;

          const didChange = await processReminders(
            col,
            dueDate,
            row,
            sheet,
            emailsWithRoles,
            senderBaseUrl,
            appBaseUrl,
            false
          );
          sheetChanged = sheetChanged || didChange;
        }

        for (const col of sheet.reportCols || []) {
          const status = row.reportStatuses?.[col.id];
          const reportDate = row.reportDates?.[col.id];

          if (!reportDate || status === "Cleared") continue;

          const didChange = await processReminders(
            col,
            reportDate,
            row,
            sheet,
            emailsWithRoles,
            senderBaseUrl,
            appBaseUrl,
            true
          );
          sheetChanged = sheetChanged || didChange;
        }
      }

      if (sheetChanged) {
        sheet.markModified("rows");
        await sheet.save();
      }
    }

    async function processReminders(col, dateValue, row, sheet, emails, senderBaseUrl, appBaseUrl, isReport) {
      const diffDays = getDateDiffDays(dateValue);
      
      // FIX: Always include 1 (tomorrow) and 0 (today) in the logic
      const rawSchedule = col.reminderDays || [30, 17, 7, 3, 1, 0];
      const schedule = [...new Set([...rawSchedule.map(Number), 1, 0])];
      
      let reminderSaved = false;

      console.log(`\n=> Checking: ${row.project} | ${col.title} (${isReport ? "Report" : "Due Date"})`);
      console.log(`   Target Date: ${dateValue}`);
      console.log(`   Days Away: ${diffDays}`);
      console.log(`   Trigger Schedule: [${schedule.join(", ")}]`);

      if (diffDays === null || !schedule.includes(diffDays)) {
        console.log(`   No match. ${diffDays} days is not in the schedule.`);
        return false;
      }

      console.log("   MATCH! Sending emails...");

      for (const { address, role } of emails) {
        const reminderKey = [
          isReport ? "report" : "due",
          col.id,
          dateValue,
          diffDays,
          role,
          address.toLowerCase(),
        ].join(":");

        if (!Array.isArray(row.sentReminderKeys)) {
          row.sentReminderKeys = [];
        }

        if (row.sentReminderKeys.includes(reminderKey)) {
          console.log(`   Skipping duplicate reminder for ${address}`);
          continue;
        }

        let customMessage = "";
        if (isReport) {
          customMessage = `${row.project} - ${col.title} report is due on ${dateValue}.`;
        } else if (role === "payer") {
          customMessage = `${row.project} - ${col.title} is pending the last date will be on ${dateValue}.`;
        } else {
          customMessage = `${row.project} - ${col.title} needs to be received on ${dateValue}.`;
        }

        try {
          const response = await fetch(`${senderBaseUrl}/api/send-email`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              to: address,
              project: row.project,
              sheetName: sheet.name,
              type: customMessage,
              role,
              sheetId: sheet._id.toString(),
              rowId: row.id.toString(),
              colId: col.id.toString(),
              isReport,
              baseUrl: appBaseUrl,
            }),
          });

          if (response.ok) {
            emailsSent++;
            row.sentReminderKeys.push(reminderKey);
            reminderSaved = true;
            console.log(`   Sent to: ${address} as [${role}]`);
          } else {
            const errorText = await response.text();
            console.error(`   Email send failed for ${address}: ${response.status} ${response.statusText} - ${errorText}`);
          }
        } catch (err) {
          console.error(`   Network error sending to ${address}:`, err);
        }

        await new Promise((resolve) => setTimeout(resolve, 1500));
      }

      return reminderSaved;
    }

    return NextResponse.json({ success: true, message: `Background scan complete. Sent ${emailsSent} emails.` });
  } catch (error) {
    console.error("Cron Error:", error);
    return NextResponse.json({ error: "Failed background scan" }, { status: 500 });
  }
}