// app/api/update-status/route.js
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

    if (!sheetId || !rowId || !colId || !status) {
      return errorHtml("Missing Information", "The link appears to be broken or incomplete.");
    }
    if (!["Cleared", "Pending"].includes(status)) {
      return errorHtml("Invalid Action", "That status update is not allowed.");
    }

    await connectMongo();

    // Find sheet by ObjectId or numeric id
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

    // Find row index — match as number OR string
    const numericRowId = Number(rowId);
    const rowIndex = sheet.rows.findIndex((r) => {
      return (
        (!isNaN(numericRowId) && Number(r.id) === numericRowId) ||
        String(r.id) === String(rowId)
      );
    });

    if (rowIndex === -1) {
      return errorHtml("Not Found", `Could not find project row (id: ${rowId}).`);
    }

    // ── KEY FIX: modify the row in JS, then use replaceOne to save the whole rows array ──
    // This avoids ALL dot-notation issues with numeric keys in nested objects.
    const rows = sheet.rows.map((r, i) => {
      if (i !== rowIndex) return r;
      const updated = { ...r };
      if (isReport) {
        updated.reportStatuses = { ...(r.reportStatuses || {}), [colId]: status };
      } else {
        updated.statuses = { ...(r.statuses || {}), [colId]: status };
      }
      return updated;
    });

    await Tracker.updateOne(
      { _id: sheet._id },
      { $set: { rows } }
    );

    console.log(`[UPDATE-STATUS] row[${rowIndex}] ${isReport ? "reportStatuses" : "statuses"}[${colId}] = ${status}`);

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
    return errorHtml("System Error", "An unexpected error occurred while saving to the database.");
  }
}