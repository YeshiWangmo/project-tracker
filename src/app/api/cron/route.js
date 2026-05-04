// app/api/cron/route.js
// ─────────────────────────────────────────────────────────────────────────────
// Called by GitHub Actions / cron-job.org every 30 min.
//
// KEY BEHAVIOURS:
//  ✅ Works whether or not "Start Project" was ever clicked (ignores hasStarted)
//  ✅ Picks up updated due dates automatically (reads live from MongoDB)
//  ✅ Picks up newly added columns automatically
//  ✅ Sends a "new column" one-time notification when a column is first seen
//  ✅ Uses sentReminderKeys to NEVER send the same reminder twice on the same day
//  ✅ Keeps firing for overdue tasks every run until marked Cleared
//  ✅ Stops ONLY when status === "Cleared"
//  ✅ Timezone-aware (Asia/Thimphu)
//  ✅ 1.5s delay between emails to respect Gmail rate limits
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import connectMongo from "../../../lib/mongodb";
import Tracker from "../../../models/Tracker";
import nodemailer from "nodemailer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const APP_TIME_ZONE = "Asia/Thimphu";

// ── Timezone helper: get year/month/day in Thimphu time ──────────────────────
function getTimeZoneDateParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return {
    year:  Number(parts.find((p) => p.type === "year")?.value),
    month: Number(parts.find((p) => p.type === "month")?.value),
    day:   Number(parts.find((p) => p.type === "day")?.value),
  };
}

// ── Compute days between today (Thimphu) and a date string ───────────────────
function getDaysLeft(dateValue, todayUtc) {
  const value = typeof dateValue === "string" ? dateValue.trim() : "";
  if (!value) return null;

  // Fast path: plain YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    const targetUtc = Date.UTC(y, m - 1, d);
    return Math.round((targetUtc - todayUtc) / 864e5);
  }

  // Fallback: parse as JS date then convert to Thimphu day
  const parsed = new Date(dateValue);
  if (isNaN(parsed.getTime())) return null;
  const parts = getTimeZoneDateParts(parsed, APP_TIME_ZONE);
  const targetUtc = Date.UTC(parts.year, parts.month - 1, parts.day);
  return Math.round((targetUtc - todayUtc) / 864e5);
}

// ── Extract unique recipients from a row ─────────────────────────────────────
function getRecipients(sheet, row) {
  const recipients = [];
  const seen = new Set();

  for (const col of sheet.emailCols || []) {
    const emailString = row.emails?.[col.id];
    if (typeof emailString !== "string" || !emailString.trim()) continue;

    const role =
      col?.role === "payer" ||
      col?.title?.toLowerCase().includes("payer")
        ? "payer"
        : "receiver";

    emailString
      .split(/[;,]/)
      .map((e) => e.trim())
      .filter((e) => e.includes("@"))
      .forEach((address) => {
        const key = address.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          recipients.push({ address, role });
        }
      });
  }
  return recipients;
}

// ── Build action buttons for payer emails ─────────────────────────────────────
function buildActionButtons(appBaseUrl, sheetMongoId, rowId, colId, isReport) {
  if (!sheetMongoId || !rowId || !colId) return "";
  const base = `${appBaseUrl}/api/update-status?sheetId=${sheetMongoId}&rowId=${rowId}&colId=${colId}&isReport=${isReport}`;
  return `
    <div style="margin-top:30px;padding-top:20px;border-top:1px dashed #cbd5e1;">
      <p style="color:#d97706;font-weight:bold;">Action Required:</p>
      <p style="font-size:14px;color:#334155;margin-bottom:15px;">
        Please update the status for this task:
      </p>
      <a href="${base}&status=Cleared"
         style="background:#10b981;color:#fff;padding:12px 20px;
                text-decoration:none;border-radius:6px;font-weight:bold;
                margin-right:10px;display:inline-block;">
        ✅ Mark as Cleared
      </a>
      <a href="${base}&status=Pending"
         style="background:#f59e0b;color:#fff;padding:12px 20px;
                text-decoration:none;border-radius:6px;font-weight:bold;
                display:inline-block;">
        ⏳ Mark as Pending
      </a>
    </div>`;
}

// ── Send one reminder email (matches send-email route template) ───────────────
async function sendEmail(transporter, { to, subject, bodyHtml }) {
  await transporter.sendMail({
    from: `"MoF Project Tracker" <${process.env.GMAIL_USER}>`,
    to,
    subject,
    html: `
      <div style="font-family:Arial,sans-serif;font-size:14px;color:#333;max-width:600px;">
        ${bodyHtml}
        <p style="margin-bottom:5px;">Thank you,</p>
        <p style="margin-top:0;font-weight:bold;">MoF Project Tracker</p>
      </div>`,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
export async function GET(req) {
  // 1. Auth check
  const authHeader = req.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    await connectMongo();

    const sheets     = await Tracker.find({});
    const appBaseUrl = process.env.NEXT_PUBLIC_APP_BASE_URL ||
                       process.env.APP_BASE_URL ||
                       "https://mof-project-tracker.vercel.app";

    // Today in Thimphu time, as a UTC midnight timestamp for diff math
    const todayParts = getTimeZoneDateParts(new Date(), APP_TIME_ZONE);
    const todayUtc   = Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day);

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });

    let emailsSent = 0;

    for (const sheet of sheets) {
      let sheetChanged = false;

      for (const row of sheet.rows || []) {
        // Skip permanently deleted rows
        if (row.isDeleted) continue;

        // Ensure tracking arrays exist
        if (!Array.isArray(row.sentReminderKeys)) row.sentReminderKeys = [];
        if (!Array.isArray(row.notifiedNewCols))  row.notifiedNewCols  = [];

        const recipients = getRecipients(sheet, row);
        if (recipients.length === 0) continue;

        const sheetMongoId = sheet._id?.toString();

        // ── PHASE 1: New-column one-time notifications ──────────────────────
        // Fires once when a column+date combo is first seen.
        // justNotifiedThisRun tracks cols notified THIS run so Phase 2 skips them.

        const justNotifiedThisRun = new Set();

        for (const col of sheet.dueTypes || []) {
          const dueDate  = row.dueDates?.[col.id];
          const colTitle = col.title || col.name || `Column ${col.id}`;
          const notifKey = `due_${col.id}`;
          if (!dueDate || row.notifiedNewCols.includes(notifKey)) continue;
          // Skip if already cleared
          if (row.statuses?.[col.id] === "Cleared") {
            row.notifiedNewCols.push(notifKey);
            sheetChanged = true;
            continue;
          }

          for (const { address, role } of recipients) {
            try {
              const buttons = role === "payer"
                ? buildActionButtons(appBaseUrl, sheetMongoId, row.id, col.id, false)
                : "";
              await sendEmail(transporter, {
                to: address,
                subject: `MoF Update: ${row.project} - Tracker`,
                bodyHtml: `
                  <p>Dear Project Manager,</p>
                  <p>This is a reminder that the <strong>${colTitle}</strong> for <strong>${row.project}</strong> is currently pending, the last date is <strong>${dueDate}</strong>.</p>
                  ${buttons ? `<p>Please click the button below to update the status once completed.</p>${buttons}` : `<p>No direct action is required from you at this time.</p>`}
                  <br/>`,
              });
              emailsSent++;
              console.log(`[NEW COL] ${address} ← ${row.project} / ${colTitle}`);
            } catch (err) {
              console.error(`[NEW COL] Email failed ${address}:`, err.message);
            }
            await new Promise((r) => setTimeout(r, 1500));
          }

          row.notifiedNewCols.push(notifKey);
          justNotifiedThisRun.add(`due_${col.id}`);
          sheetChanged = true;
        }

        for (const col of sheet.reportCols || []) {
          const repDate  = row.reportDates?.[col.id];
          const colTitle = col.title || col.name || `Column ${col.id}`;
          const notifKey = `report_${col.id}`;
          if (!repDate || row.notifiedNewCols.includes(notifKey)) continue;
          if (row.reportStatuses?.[col.id] === "Cleared") {
            row.notifiedNewCols.push(notifKey);
            sheetChanged = true;
            continue;
          }

          for (const { address, role } of recipients) {
            try {
              const buttons = role === "payer"
                ? buildActionButtons(appBaseUrl, sheetMongoId, row.id, col.id, true)
                : "";
              await sendEmail(transporter, {
                to: address,
                subject: `MoF Update: ${row.project} - Tracker`,
                bodyHtml: `
                  <p>Dear Project Manager,</p>
                  <p>This is a reminder that the <strong>${colTitle}</strong> report for <strong>${row.project}</strong> is currently pending, the last date is <strong>${repDate}</strong>.</p>
                  ${buttons ? `<p>Please click the button below to update the status once completed.</p>${buttons}` : `<p>No direct action is required from you at this time.</p>`}
                  <br/>`,
              });
              emailsSent++;
              console.log(`[NEW COL] ${address} ← ${row.project} / ${colTitle} (report)`);
            } catch (err) {
              console.error(`[NEW COL] Email failed ${address}:`, err.message);
            }
            await new Promise((r) => setTimeout(r, 1500));
          }

          row.notifiedNewCols.push(notifKey);
          justNotifiedThisRun.add(`report_${col.id}`);
          sheetChanged = true;
        }

        // ── PHASE 2: Scheduled reminders ────────────────────────────────────
        // Fires on exact reminder days (e.g. 180, 90, 30, 14, 3, 1, 0).
        // For overdue tasks (daysLeft < 0) fires on EVERY cron run until Cleared.
        // sentReminderKeys prevents duplicate sends on the same day.

        const processReminders = async (col, dateValue, isReport) => {
          // Skip if this column just got a "new column" email this same run
          const phaseOneKey = `${isReport ? "report" : "due"}_${col.id}`;
          if (justNotifiedThisRun.has(phaseOneKey)) return;

          const colTitle = col.title || col.name || `Column ${col.id}`;
          const status = isReport
            ? row.reportStatuses?.[col.id]
            : row.statuses?.[col.id];

          // ✅ ONLY stop when explicitly Cleared
          if (status === "Cleared") return;
          if (!dateValue) return;

          const daysLeft = getDaysLeft(dateValue, todayUtc);
          if (daysLeft === null) return;

          // Build the reminder schedule — always include day 1 and day 0
          const rawDays  = col.reminderDays?.length
            ? col.reminderDays
            : [180, 90, 30, 14, 3, 1, 0];
          const schedule = [...new Set([...rawDays.map(Number), 1, 0])];

          // For overdue: fire every run. For future: only on scheduled days.
          const isOverdue       = daysLeft < 0;
          const isScheduledDay  = schedule.includes(daysLeft);
          if (!isOverdue && !isScheduledDay) return;

          for (const { address, role } of recipients) {
            // Unique key = column + date + daysLeft + role + address
            // Using daysLeft in the key means each reminder-day fires only ONCE.
            // Overdue keys include the actual daysLeft so each day is unique.
            const reminderKey = [
              isReport ? "report" : "due",
              col.id,
              dateValue,
              daysLeft,
              role,
              address.toLowerCase(),
            ].join(":");

            if (row.sentReminderKeys.includes(reminderKey)) continue;

            const overdueLabel = isOverdue
              ? `⚠️ OVERDUE by ${Math.abs(daysLeft)} day(s)`
              : daysLeft === 0
                ? "⚠️ DUE TODAY"
                : `${daysLeft} day(s) remaining`;

            const message = isReport
              ? `${row.project} — <strong>${colTitle}</strong> report is due on <strong>${dateValue}</strong>. (${overdueLabel})`
              : role === "payer"
                ? `${row.project} — <strong>${colTitle}</strong> payment/action is due on <strong>${dateValue}</strong>. (${overdueLabel})`
                : `${row.project} — <strong>${colTitle}</strong> needs to be received by <strong>${dateValue}</strong>. (${overdueLabel})`;

            const buttons = role === "payer"
              ? buildActionButtons(appBaseUrl, sheetMongoId, row.id, col.id, isReport)
              : "";

            const subjectLabel = isOverdue
              ? `OVERDUE — ${colTitle} / ${row.project}`
              : daysLeft === 0
                ? `DUE TODAY — ${colTitle} / ${row.project}`
                : `${daysLeft}d left — ${colTitle} / ${row.project}`;

            try {
              await sendEmail(transporter, {
                to: address,
                subject: `MoF Update: ${row.project} - Tracker`,
                bodyHtml: `
                  <p>Dear Project Manager,</p>
                  ${buttons
                    ? `<p>This is a reminder that the <strong>${message}</strong> for <strong>${row.project}</strong> is currently pending.</p>
                       <p>Please click the button below to update the status once completed.</p>
                       ${buttons}`
                    : `<p>This is an informational update regarding <strong>${row.project}</strong>.</p>
                       <p>${message}</p>
                       <p>No direct action is required from you at this time.</p>`
                  }
                  <br/>`,
              });
              emailsSent++;
              row.sentReminderKeys.push(reminderKey);
              sheetChanged = true;
              console.log(`[REMINDER] ${address} ← ${row.project} / ${colTitle} / ${daysLeft}d`);
            } catch (err) {
              console.error(`[REMINDER] Email failed ${address}:`, err.message);
            }
            await new Promise((r) => setTimeout(r, 1500));
          }
        };

        for (const col of sheet.dueTypes || []) {
          await processReminders(col, row.dueDates?.[col.id], false);
        }
        for (const col of sheet.reportCols || []) {
          await processReminders(col, row.reportDates?.[col.id], true);
        }
      }

      if (sheetChanged) {
        sheet.markModified("rows");
        await sheet.save();
        console.log(`[CRON] Saved changes → sheet: ${sheet.name}`);
      }
    }

    console.log(`[CRON] Done. Emails sent: ${emailsSent}`);
    return NextResponse.json({
      success: true,
      emailsSent,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[CRON] Fatal error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}