// app/api/update-status/route.js
// Handles "Mark as Cleared / Pending" button clicks from reminder emails.
// Robust ID matching: handles row.id as Number OR String in MongoDB.

import { NextResponse } from "next/server";
import connectMongo from "../../../lib/mongodb";
import Tracker from "../../../models/Tracker";
import mongoose from "mongoose";

function errorHtml(title, message) {
  return new NextResponse(`
    <html>
      <body style="font-family:sans-serif;display:flex;justify-content:center;
                   align-items:center;height:100vh;background:#f8fafc;margin:0;">
        <div style="background:white;padding:40px;border-radius:12px;
                    box-shadow:0 4px 15px rgba(0,0,0,0.1);text-align:center;
                    max-width:400px;border-top:4px solid #ef4444;">
          <div style="font-size:50px;margin-bottom:10px;">⚠️</div>
          <h1 style="color:#ef4444;margin-top:0;">${title}</h1>
          <p style="font-size:16px;color:#475569;line-height:1.5;">${message}</p>
          <p style="color:#94a3b8;margin-top:30px;font-size:14px;">
            Please contact the administrator or try again.
          </p>
        </div>
      </body>
    </html>
  `, { status: 400, headers: { "Content-Type": "text/html" } });
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const sheetId  = searchParams.get("sheetId");
    const rowId    = searchParams.get("rowId");
    const colId    = searchParams.get("colId");
    const status   = searchParams.get("status");
    const isReport = searchParams.get("isReport") === "true";

    // ── Security checks ────────────────────────────────────────────────────
    if (!sheetId || !rowId || !colId || !status) {
      return errorHtml("Missing Information", "The link appears to be broken or incomplete.");
    }
    if (!["Cleared", "Pending"].includes(status)) {
      return errorHtml("Invalid Action", "That status update is not allowed.");
    }

    await connectMongo();

    // ── Find sheet — try ObjectId, numeric id, and string id ──────────────
    const queryOptions = [];
    if (mongoose.Types.ObjectId.isValid(sheetId)) {
      queryOptions.push({ _id: sheetId });
    }
    const numericSheetId = Number(sheetId);
    if (!isNaN(numericSheetId)) {
      queryOptions.push({ id: numericSheetId });
    }
    queryOptions.push({ id: sheetId });

    const sheet = await Tracker.findOne({ $or: queryOptions });
    if (!sheet) {
      return errorHtml("Database Error", "Project Tracker sheet not found.");
    }

    // ── Find row — compare as BOTH number and string to handle schema cast ─
    // row.id is stored as Number in the schema, so Number(rowId) is the fix.
    const numericRowId = Number(rowId);
    const rowIndex = sheet.rows.findIndex((r) => {
      const rId = r.id;
      // Match if numeric ids equal, OR string representations match
      return (
        (!isNaN(numericRowId) && Number(rId) === numericRowId) ||
        String(rId) === String(rowId)
      );
    });

    if (rowIndex === -1) {
      return errorHtml(
        "Not Found",
        `Could not find project row (id: ${rowId}). It may have been deleted.`
      );
    }

    // ── Update using atomic $set to avoid Mongoose cast issues ───────────
    // Direct assignment on nested mixed/map fields can fail — $set is safe.
    const statusField = isReport
      ? `rows.${rowIndex}.reportStatuses.${colId}`
      : `rows.${rowIndex}.statuses.${colId}`;

    await sheet.constructor.updateOne(
      { _id: sheet._id },
      { $set: { [statusField]: status } }
    );

    console.log(`[UPDATE-STATUS] Set ${statusField} = ${status} on sheet ${sheet._id}`);

    // ── Success page ───────────────────────────────────────────────────────
    const color = status === "Cleared" ? "#10b981" : "#f59e0b";
    const icon  = status === "Cleared" ? "✅" : "⏳";

    return new NextResponse(`
      <html>
        <body style="font-family:sans-serif;display:flex;justify-content:center;
                     align-items:center;height:100vh;background:#f8fafc;margin:0;">
          <div style="background:white;padding:40px;border-radius:12px;
                      box-shadow:0 4px 15px rgba(0,0,0,0.1);text-align:center;
                      max-width:400px;border-top:4px solid ${color};">
            <div style="font-size:50px;margin-bottom:10px;">${icon}</div>
            <h1 style="color:${color};margin-top:0;">Status Updated!</h1>
            <p style="font-size:16px;color:#475569;line-height:1.5;">
              The task has been marked as <strong>${status}</strong>.
            </p>
            <p style="color:#94a3b8;margin-top:30px;font-size:14px;">
              You can safely close this window.
            </p>
          </div>
        </body>
      </html>
    `, { headers: { "Content-Type": "text/html" } });

  } catch (error) {
    console.error("Error updating status via email:", error);
    return errorHtml(
      "System Error",
      "An unexpected error occurred while saving to the database."
    );
  }
}