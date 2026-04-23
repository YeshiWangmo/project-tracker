import { NextResponse } from "next/server";
import connectMongo from "../../../lib/mongodb";
import Tracker from "../../../models/Tracker";
import nodemailer from "nodemailer"; 

const APP_TIME_ZONE = "Asia/Thimphu";

function getTimeZoneDateParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
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
    const appBaseUrl = "https://project-tracker-nine-phi.vercel.app"; // Updated to match your frontend

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    });

    const extractEmailsWithRoles = (sheet, row) => {
      const recipients = [];
      const seenEmails = new Set();
      for (const col of sheet.emailCols || []) {
        const emailString = row.emails?.[col.id];
        if (typeof emailString !== "string" || emailString.trim() === "") continue;
        let role = col?.role === "payer" || (col?.title && col.title.toLowerCase().includes("payer")) ? "payer" : "receiver";
        
        emailString.split(/[;,]/).map((email) => email.trim()).filter((email) => email.includes("@")).forEach(address => {
          const lowerAddress = address.toLowerCase();
          if (!seenEmails.has(lowerAddress)) {
            seenEmails.add(lowerAddress);
            recipients.push({ address, role });
          }
        });
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
      const rawSchedule = col.reminderDays || [180, 90, 30, 14, 3, 1, 0];
      const schedule = [...new Set([...rawSchedule.map(Number), 1, 0])];
      let reminderSaved = false;

      if (diffDays === null || !schedule.includes(diffDays)) return false;

      for (const { address, role } of emails) {
        const reminderKey = [isReport ? "report" : "due", col.id, dateValue, diffDays, role, address.toLowerCase()].join(":");
        if (!Array.isArray(row.sentReminderKeys)) row.sentReminderKeys = [];
        if (row.sentReminderKeys.includes(reminderKey)) continue;

        let customMessage = isReport ? `${row.project} - ${col.title} report is due on ${dateValue}.` 
          : role === "payer" ? `${row.project} - ${col.title} is pending, the last date is ${dateValue}.` 
          : `${row.project} - ${col.title} needs to be received on ${dateValue}.`;

        try {
          let actionButtons = "";
          if (role === "payer" && sheet._id && row.id && col.id) {
            const clearedLink = `${appBaseUrl}/api/update-status?sheetId=${sheet._id.toString()}&rowId=${row.id}&colId=${col.id}&status=Cleared&isReport=${isReport}`;
            const pendingLink = `${appBaseUrl}/api/update-status?sheetId=${sheet._id.toString()}&rowId=${row.id}&colId=${col.id}&status=Pending&isReport=${isReport}`;

            actionButtons = `
              <div style="margin-top: 30px; padding-top: 20px; border-top: 1px dashed #cbd5e1;">
                <p style="color: #d97706; font-weight: bold;">Action Required:</p>
                <p style="font-size: 14px; color: #334155; margin-bottom: 15px;">Please update the status for this task:</p>
                <a href="${clearedLink}" style="background-color: #10b981; color: white; padding: 12px 20px; text-decoration: none; border-radius: 6px; font-weight: bold; margin-right: 10px; display: inline-block;">Mark as Cleared</a>
                <a href="${pendingLink}" style="background-color: #f59e0b; color: white; padding: 12px 20px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Mark as Pending</a>
              </div>
            `;
          }

          const mailOptions = {
            from: `"MoF Project Tracker" <${process.env.GMAIL_USER}>`,
            to: address,
            subject: `MoF Update: ${row.project} - Tracker`,
            html: `
              <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px; max-width: 600px;">
                <h2 style="color: #2563eb; margin-top: 0;">MoF Project Tracker</h2>
                <div style="background-color: #f8fafc; padding: 15px; border-left: 4px solid #3b82f6; margin: 20px 0; font-size: 16px;">
                  <p style="margin: 0;"><strong>Project:</strong> ${row.project}</p>
                  <p style="margin: 10px 0 0 0;"><strong>Message:</strong> ${customMessage}</p>
                </div>
                ${actionButtons}
                <hr style="margin: 30px 0 20px 0; border: none; border-top: 1px solid #e2e8f0;" />
                <p style="font-size: 12px; color: #94a3b8; text-align: center;">
                  This is an automated notification from the Ministry of Finance, Bhutan.
                </p>
              </div>
            `,
          };

          await transporter.sendMail(mailOptions);
          emailsSent++;
          row.sentReminderKeys.push(reminderKey);
          reminderSaved = true;
        } catch (err) {
          console.error(`Email send failed for ${address}:`, err);
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      return reminderSaved;
    }

    return NextResponse.json({ success: true, message: `Background scan complete. Sent ${emailsSent} emails.` });
  } catch (error) {
    return NextResponse.json({ error: "Failed background scan" }, { status: 500 });
  }
}