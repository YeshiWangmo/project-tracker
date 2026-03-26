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

    // This loops through the database completely behind the scenes
    for (const sheet of sheets) {
      const safeRows = Array.isArray(sheet.rows) ? sheet.rows : [];
      
      for (const row of safeRows) {
        const emailsToNotify = Object.values(row.emails || {});
        if (emailsToNotify.length === 0) continue;

        // Check Due Dates
        for (const col of (sheet.dueTypes || [])) {
          if (row.statuses?.[col.id] === "Cleared" || !row.dueDates?.[col.id]) continue;
          
          const dueDate = new Date(row.dueDates[col.id]);
          dueDate.setHours(0, 0, 0, 0);
          const diffDays = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24)); 
          const schedule = col.reminderDays || [30, 17, 7, 3];

          if (schedule.includes(diffDays)) {
            for (const emailAddr of emailsToNotify) {
              
              // THE FIX IS ADDED HERE: method: "POST"
              await fetch(`https://project-tracker-nine-phi.vercel.app/api/send-email`, {
                method: "POST", 
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ to: emailAddr, project: row.project, sheetName: sheet.name, type: `${col.title} - ${diffDays} DAY REMINDER` })
              });
              emailsSent++;
              
            }
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