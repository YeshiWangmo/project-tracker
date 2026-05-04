// app/api/reset-keys/route.js
// ─────────────────────────────────────────────────────────────────────────────
// ONE-TIME USE: Clears sentReminderKeys and notifiedNewCols from all rows
// so the cron can send fresh emails with correct links.
// DELETE THIS FILE after running it once.
// ─────────────────────────────────────────────────────────────────────────────
import { NextResponse } from "next/server";
import connectMongo from "../../../lib/mongodb";
import Tracker from "../../../models/Tracker";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get("secret");

  // Basic protection so random people can't reset your data
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await connectMongo();
  const sheets = await Tracker.find({});
  let rowsReset = 0;

  for (const sheet of sheets) {
    let changed = false;
    for (const row of sheet.rows || []) {
      if (
        (Array.isArray(row.sentReminderKeys) && row.sentReminderKeys.length > 0) ||
        (Array.isArray(row.notifiedNewCols) && row.notifiedNewCols.length > 0)
      ) {
        row.sentReminderKeys = [];
        row.notifiedNewCols = [];
        changed = true;
        rowsReset++;
      }
    }
    if (changed) {
      sheet.markModified("rows");
      await sheet.save();
    }
  }

  return NextResponse.json({
    success: true,
    rowsReset,
    message: `Cleared reminder keys from ${rowsReset} rows. Delete this file now!`,
  });
}