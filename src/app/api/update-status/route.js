// app/api/update-status/route.js
import { NextResponse } from "next/server";
import connectMongo from "../../../lib/mongodb";
import Tracker from "../../../models/Tracker";
import mongoose from "mongoose";

function errorHtml(title, message) {
  return new NextResponse(`<html><body style="font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;background:#f8fafc;margin:0;"><div style="background:white;padding:40px;border-radius:12px;box-shadow:0 4px 15px rgba(0,0,0,0.1);text-align:center;max-width:400px;border-top:4px solid #ef4444;"><h1 style="color:#ef4444;">${title}</h1><p style="color:#475569;">${message}</p></div></body></html>`, 
  { status: 400, headers: { "Content-Type": "text/html" } });
}

function successHtml(status) {
  const color = status === "Cleared" ? "#10b981" : "#f59e0b";
  const icon = status === "Cleared" ? "&#9989;" : "&#9203;";
  return new NextResponse(`<html><body style="font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;background:#f8fafc;margin:0;"><div style="background:white;padding:40px;border-radius:12px;box-shadow:0 4px 15px rgba(0,0,0,0.1);text-align:center;max-width:400px;border-top:4px solid ${color};"><div style="font-size:50px;">${icon}</div><h1 style="color:${color};">Status Updated!</h1><p style="color:#475569;">Marked as <strong>${status}</strong>.</p><p style="color:#94a3b8;font-size:14px;">You can safely close this window.</p></div></body></html>`,
  { headers: { "Content-Type": "text/html" } });
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const sheetId  = searchParams.get("sheetId");
    const rowId    = searchParams.get("rowId");
    const colId    = searchParams.get("colId");
    const status   = searchParams.get("status");
    const isReport = searchParams.get("isReport") === "true";

    console.log(`[UPDATE-STATUS] sheetId=${sheetId} rowId=${rowId} colId=${colId} status=${status} isReport=${isReport}`);

    if (!sheetId || !rowId || !colId || !status) {
      return errorHtml("Missing Information", "The link appears to be broken or incomplete.");
    }
    if (!["Cleared", "Pending"].includes(status)) {
      return errorHtml("Invalid Action", "That status update is not allowed.");
    }

    await connectMongo();

    // Find sheet
    const queryOptions = [];
    if (mongoose.Types.ObjectId.isValid(sheetId)) queryOptions.push({ _id: new mongoose.Types.ObjectId(sheetId) });
    const numericSheetId = Number(sheetId);
    if (!isNaN(numericSheetId) && numericSheetId > 0) queryOptions.push({ id: numericSheetId });

    const sheet = await Tracker.findOne({ $or: queryOptions }).lean();
    if (!sheet) return errorHtml("Not Found", `Sheet not found for id: ${sheetId}`);

    console.log(`[UPDATE-STATUS] Found sheet: ${sheet.name}, rows: ${sheet.rows?.length}`);

    // Find row - use string comparison only to avoid any cast issues
    const rowIdStr = String(rowId);
    const rowIndex = (sheet.rows || []).findIndex(r => String(r.id) === rowIdStr);

    console.log(`[UPDATE-STATUS] rowIndex=${rowIndex} for rowId=${rowIdStr}`);

    if (rowIndex === -1) return errorHtml("Not Found", `Row not found for id: ${rowId}`);

    // Build the updated rows array in JS (no dot notation, no cast issues)
    const updatedRows = sheet.rows.map((r, i) => {
      if (i !== rowIndex) return r;
      if (isReport) {
        return { ...r, reportStatuses: { ...(r.reportStatuses || {}), [colId]: status } };
      } else {
        return { ...r, statuses: { ...(r.statuses || {}), [colId]: status } };
      }
    });

    // Save using raw MongoDB driver to bypass ALL Mongoose casting
    const db = mongoose.connection.db;
    await db.collection("trackers").updateOne(
      { _id: sheet._id },
      { $set: { rows: updatedRows } }
    );

    console.log(`[UPDATE-STATUS] SUCCESS - saved rows for sheet ${sheet._id}`);
    return successHtml(status);

  } catch (error) {
    console.error("[UPDATE-STATUS] Error:", error);
    return errorHtml("System Error", `${error.message}`);
  }
}