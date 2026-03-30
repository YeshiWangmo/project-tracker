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

    const baseUrl = "https://project-tracker-nine-phi.vercel.app";

    // --- FIX 1: DEDUPLICATE EMAILS ---
    const extractEmailsWithRoles = (sheet, row) => {
      const recipients = [];
      const seenEmails = new Set(); // This memory box stops duplicates

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
          // Only add the email if we haven't seen it yet for this row
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
        const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
        return Math.round((targetUtc - todayUtc) / (1000 * 60 * 60 * 24));
      }

      const targetDate = new Date(dateValue);
      if (Number.isNaN(targetDate.getTime())) return null;
      targetDate.setHours(0, 0, 0, 0);
      return Math.round((targetDate - today) / (1000 * 60 * 60 * 24));
    };

    for (const sheet of sheets) {
      const safeRows = Array.isArray(sheet.rows) ? sheet.rows : [];
      
      for (const row of safeRows) {
        const emailsWithRoles = extractEmailsWithRoles(sheet, row);

        if (emailsWithRoles.length === 0) continue;

        for (const col of (sheet.dueTypes || [])) {
          const status = row.statuses?.[col.id];
          const dueDate = row.dueDates?.[col.id];

          if (!dueDate || status === "Cleared") continue;
          
          // Passing the whole 'row' and 'sheet' objects now!
          await processReminders(col, dueDate, row, sheet, emailsWithRoles, baseUrl, false);
        }

        for (const col of (sheet.reportCols || [])) {
          const status = row.reportStatuses?.[col.id];
          const reportDate = row.reportDates?.[col.id];

          if (!reportDate || status === "Cleared") continue;

          // Passing the whole 'row' and 'sheet' objects now!
          await processReminders(col, reportDate, row, sheet, emailsWithRoles, baseUrl, true);
        }
      }
    }

    async function processReminders(col, dateValue, row, sheet, emails, baseUrl, isReport) {
      const diffDays = getDateDiffDays(dateValue);
      const rawSchedule = col.reminderDays || [30, 17, 7, 3];
      const schedule = rawSchedule.map(Number); 

      console.log(`\n=> Checking: ${row.project} | ${col.title} (${isReport ? "Report" : "Due Date"})`);
      console.log(`   Target Date: ${dateValue}`);
      console.log(`   Days Away: ${diffDays}`);
      console.log(`   Trigger Schedule: [${schedule.join(", ")}]`);

      if (diffDays !== null && schedule.includes(diffDays)) {
        console.log(`   ✅ MATCH! Sending emails...`);
        for (const { address, role } of emails) {
          let customMessage = "";
          if (isReport) {
            customMessage = `${row.project} - ${col.title} report is due on ${dateValue}.`;
          } else if (role === "payer") {
            customMessage = `${row.project} - ${col.title} is pending the last date will be on ${dateValue}.`;
          } else {
            customMessage = `${row.project} - ${col.title} needs to be received on ${dateValue}.`;
          }

          try {
            // --- FIX 2: SENDING THE IDs FOR THE BUTTONS ---
            const response = await fetch(`${baseUrl}/api/send-email`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                to: address,
                project: row.project,
                sheetName: sheet.name,
                type: customMessage,
                role: role,
                sheetId: sheet._id.toString(),
                rowId: row.id.toString(),
                colId: col.id.toString(),
                isReport: isReport,
                baseUrl: baseUrl
              })
            });

            if (response.ok) {
              emailsSent++;
              console.log(`   ✉️  Sent to: ${address} as [${role}]`);
            }
          } catch (err) {
            console.error(`   ❌ Network error sending to ${address}:`, err);
          }

          // --- FIX 3: SPEED LIMIT (Wait 1.5 seconds between emails) ---
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      } else {
         console.log(`   ⏳ No Match. ${diffDays} days is not in the schedule.`);
      }
    }

    return NextResponse.json({ success: true, message: `Background scan complete. Sent ${emailsSent} emails.` });
  } catch (error) {
    console.error("Cron Error:", error);
    return NextResponse.json({ error: "Failed background scan" }, { status: 500 });
  }
}
