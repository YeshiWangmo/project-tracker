// app/api/reset-keys/route.js
// ONE-TIME USE: Clears sentReminderKeys and pre-populates notifiedNewCols
// for all already-started rows so cron stops sending duplicate new-col emails.
// DELETE THIS FILE after running it once.

import { NextResponse } from "next/server";
import connectMongo from "../../../lib/mongodb";
import Tracker from "../../../models/Tracker";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get("secret");

  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await connectMongo();
  const sheets = await Tracker.find({});
  let rowsReset = 0;

  for (const sheet of sheets) {
    let changed = false;

    for (const row of sheet.rows || []) {
      // Pre-populate notifiedNewCols with ALL existing columns for started rows
      // so cron never sends "new column" notifications for existing columns
      const allColKeys = [
        ...(sheet.dueTypes || []).map(col => `due_${col.id}`),
        ...(sheet.reportCols || []).map(col => `report_${col.id}`),
      ];

      row.sentReminderKeys = [];
      row.notifiedNewCols = row.hasStarted ? allColKeys : [];
      changed = true;
      rowsReset++;
    }

    if (changed) {
      sheet.markModified("rows");
      await sheet.save();
    }
  }

  return NextResponse.json({
    success: true,
    rowsReset,
    message: `Reset ${rowsReset} rows. Started rows now have notifiedNewCols pre-populated. Delete this file now!`,
  });
}