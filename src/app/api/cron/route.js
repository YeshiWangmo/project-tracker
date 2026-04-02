import { NextResponse } from "next/server";
import connectMongo from "../../../lib/mongodb";
import Tracker from "../../../models/Tracker";
import nodemailer from "nodemailer";

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

    const appBaseUrl = "https://mof-project-tracker.vercel.app"; // Your actual domain

    // 🚀 DIRECT EMAIL SENDER - Bypasses Vercel 404 error entirely
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });

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

          if (!dueDate || status === "Cleared") continue; // Still respects the "Cleared" status!

          const didChange = await processReminders(col, dueDate, row, sheet, emailsWithRoles, appBaseUrl, false);
          sheetChanged = sheetChanged || didChange;
        }

        for (const col of sheet.reportCols || []) {
          const status = row.reportStatuses?.[col.id];
          const reportDate = row.reportDates?.[col.id];

          if (!reportDate || status === "Cleared") continue;

          const didChange = await processReminders(col, reportDate, row, sheet, emailsWithRoles, appBaseUrl, true);
          sheetChanged = sheetChanged || didChange;
        }
      }

      if (sheetChanged) {
        sheet.markModified("rows");
        await sheet.save();
      }
    }

    async function processReminders(col, dateValue, row, sheet, emails, appBaseUrl, isReport) {
      const diffDays = getDateDiffDays(dateValue);
      let reminderSaved = false;

      console.log(`\n=> Checking: ${row.project} | ${col.title}`);
      
      // ☢️ NUCLEAR OPTION ACTIVE: Date logic commented out to FORCE emails right now.
      // const rawSchedule = col.reminderDays || [30, 17, 7, 3, 1, 0];
      // const schedule = [...new Set([...rawSchedule.map(Number), 1, 0])];
      // if (diffDays === null || !schedule.includes(diffDays)) { return false; }

      console.log("   FORCING EMAIL SEND (Emergency override active)...");

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

        // ☢️ NUCLEAR OPTION ACTIVE: Spam blocker disabled to FORCE emails.
        // if (row.sentReminderKeys.includes(reminderKey)) { continue; }

        let customMessage = "";
        if (isReport) {
          customMessage = `${row.project} - ${col.title} report is due on ${dateValue}.`;
        } else if (role === "payer") {
          customMessage = `${row.project} - ${col.title} is pending, the last date will be on ${dateValue}.`;
        } else {
          customMessage = `${row.project} - ${col.title} needs to be received on ${dateValue}.`;
        }

        try {
          let actionButtons = "";
          if (role === "payer" && sheet._id && row.id && col.id) {
            const clearedLink = `${appBaseUrl}/api/update-status?sheetId=${sheet._id.toString()}&rowId=${row.id}&colId=${col.id}&status=Cleared&isReport=${isReport}`;
            const pendingLink = `${appBaseUrl}/api/update-status?sheetId=${sheet._id.toString()}&rowId=${row.id}&colId=${col.id}&status=Pending&isReport=${isReport}`;

            actionButtons = `
              <div style="margin-top: 30px; padding-top: 20px; border-top: 1px dashed #cbd5e1;">
                <p style="font-size: 14px; color: #334155; margin-bottom: 15px;"><strong>Update the status directly:</strong></p>
                <a href="${clearedLink}" style="background-color: #10b981; color: white; padding: 12px 20px; text-decoration: none; border-radius: 6px; font-weight: bold; margin-right: 10px; display: inline-block;">Mark as Cleared</a>
                <a href="${pendingLink}" style="background-color: #f59e0b; color: white; padding: 12px 20px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Mark as Pending</a>
              </div>
            `;
          }

          const mailOptions = {
            from: `"MoF Project Tracker" <${process.env.GMAIL_USER}>`,
            to: address,
            subject: `${row.project} - Tracker Update`,
            text: customMessage,
            html: `
              <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px; max-width: 600px;">
                <h2 style="color: #1e293b; margin-top: 0;">Project Update</h2>
                <p style="font-size: 16px; color: #334155;"><strong>Project:</strong> ${row.project}</p>
                <p style="font-size: 16px; color: #334155;"><strong>Message:</strong> ${customMessage}</p>
                ${actionButtons}
                <hr style="margin: 20px 0; border: none; border-top: 1px solid #cbd5e1;" />
                <p style="font-size: 12px; color: #94a3b8;">
                  This is an automated notification from the MoF Project Tracker.
                </p>
              </div>
            `,
          };

          await transporter.sendMail(mailOptions);
          emailsSent++;
          row.sentReminderKeys.push(reminderKey);
          reminderSaved = true;
          console.log(`   Sent successfully to: ${address}`);
        } catch (err) {
          console.error(`   Email send failed for ${address}:`, err);
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