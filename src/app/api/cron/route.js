import { NextResponse } from "next/server";
import connectMongo from "../../../lib/mongodb";
import Tracker from "../../../models/Tracker"; 

export async function GET(req) {
  try {
    await connectMongo();
    const sheets = await Tracker.find({});
    
    let emailsSent = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const host = req.headers.get("host") || "project-tracker-nine-phi.vercel.app";
    const protocol = host.includes("localhost") ? "http" : "https";
    const baseUrl = `${protocol}://${host}`;

    for (const sheet of sheets) {
      const safeRows = Array.isArray(sheet.rows) ? sheet.rows : [];
      
      for (const row of safeRows) {
        const emailsWithRoles = [];

        for (const [colId, emailString] of Object.entries(row.emails || {})) {
          if (typeof emailString === "string" && emailString.trim() !== "") {
            const colDef = (sheet.emailCols || []).find(
              (c) => c?.id?.toString() === colId
            );
            const role = colDef?.role === "payer" ? "payer" : "receiver";

            const splitEmails = emailString.split(",").map(e => e.trim());
            for (const email of splitEmails) {
              if (email.includes("@")) {
                emailsWithRoles.push({ address: email, role });
              }
            }
          }
        }

        if (emailsWithRoles.length === 0) continue;

        // --- SCAN 1: DUE DATES ---
        for (const col of (sheet.dueTypes || [])) {
          if (row.statuses?.[col.id] === "Cleared" || !row.dueDates?.[col.id]) continue;
          await processReminders(col, row.dueDates[col.id], row.project, sheet.name, emailsWithRoles, baseUrl, false);
        }

        // --- SCAN 2: REPORT DATES ---
        for (const col of (sheet.reportCols || [])) {
          if (row.reportStatuses?.[col.id] === "Cleared" || !row.reportDates?.[col.id]) continue;
          await processReminders(col, row.reportDates[col.id], row.project, sheet.name, emailsWithRoles, baseUrl, true);
        }
      }
    }

    async function processReminders(col, dateValue, projectName, sheetName, emails, baseUrl, isReport) {
      const targetDate = new Date(dateValue);
      targetDate.setHours(0, 0, 0, 0);
      const diffDays = Math.ceil((targetDate - today) / (1000 * 60 * 60 * 24));
      const schedule = col.reminderDays || [30, 17, 7, 3];

      if (schedule.includes(diffDays)) {
        for (const { address, role } of emails) {
          let customMessage = "";
          if (isReport) {
            customMessage = `${projectName} - ${col.title} report is due on ${dateValue}.`;
          } else if (role === "payer") {
            customMessage = `${projectName} - ${col.title} is pending the last date will be on ${dateValue}.`;
          } else {
            customMessage = `${projectName} - ${col.title} needs to be received on ${dateValue}.`;
          }

          try {
            const response = await fetch(`${baseUrl}/api/send-email`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                to: address,
                project: projectName,
                sheetName,
                type: customMessage
              })
            });

            if (response.ok) {
              emailsSent++;
            }
          } catch (err) {
            console.error(`Network error sending to ${address}:`, err);
          }
        }
      }
    }

    return NextResponse.json({ success: true, message: `Background scan complete. Sent ${emailsSent} emails.` });
  } catch (error) {
    console.error("Cron Error:", error);
    return NextResponse.json({ error: "Failed background scan" }, { status: 500 });
  }
}
