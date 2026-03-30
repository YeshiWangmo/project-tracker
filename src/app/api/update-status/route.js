import { NextResponse } from "next/server";
import connectMongo from "../../../lib/mongodb"; 
import Tracker from "../../../models/Tracker"; 

export async function GET(req) {
  try {
    // 1. Grab the IDs and the new Status from the URL the email generated
    const { searchParams } = new URL(req.url);
    const sheetId = searchParams.get("sheetId");
    const rowId = searchParams.get("rowId");
    const colId = searchParams.get("colId");
    const status = searchParams.get("status");
    const isReport = searchParams.get("isReport") === "true";

    if (!sheetId || !rowId || !colId || !status) {
      return new NextResponse("Missing required parameters", { status: 400 });
    }

    await connectMongo();

    // 2. Find the tracker sheet
    const sheet = await Tracker.findById(sheetId);
    if (!sheet) {
      return new NextResponse("Project Tracker not found", { status: 404 });
    }

    // 3. Find the exact row
    const rowIndex = sheet.rows.findIndex(r => r.id.toString() === rowId);
    if (rowIndex === -1) {
      return new NextResponse("Project Row not found", { status: 404 });
    }

    // 4. Update the status (checking if it's a Report column or Due Date column)
    if (isReport) {
      if (!sheet.rows[rowIndex].reportStatuses) sheet.rows[rowIndex].reportStatuses = {};
      sheet.rows[rowIndex].reportStatuses[colId] = status;
    } else {
      if (!sheet.rows[rowIndex].statuses) sheet.rows[rowIndex].statuses = {};
      sheet.rows[rowIndex].statuses[colId] = status;
    }

    // 5. Tell MongoDB to save the changes inside the 'rows' array
    sheet.markModified('rows');
    await sheet.save();

    // 6. Return a beautiful Success Page to the user's browser!
    const html = `
      <html>
        <body style="font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background-color: #f8fafc; margin: 0;">
          <div style="background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); text-align: center; max-width: 400px;">
            <div style="font-size: 50px; margin-bottom: 10px;">
              ${status === 'Cleared' ? '✅' : '⏳'}
            </div>
            <h1 style="color: ${status === 'Cleared' ? '#10b981' : '#f59e0b'}; margin-top: 0;">Status Updated!</h1>
            <p style="font-size: 16px; color: #475569; line-height: 1.5;">
              The task has successfully been marked as <strong>${status}</strong> in the database.
            </p>
            <p style="color: #94a3b8; margin-top: 30px; font-size: 14px;">You can safely close this window.</p>
          </div>
        </body>
      </html>
    `;

    return new NextResponse(html, { headers: { 'Content-Type': 'text/html' } });

  } catch (error) {
    console.error("Error updating status via email:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}