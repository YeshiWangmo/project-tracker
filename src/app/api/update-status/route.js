import { NextResponse } from "next/server";
import connectMongo from "../../../lib/mongodb"; 
import Tracker from "../../../models/Tracker"; 

// Helper function to return beautiful error pages instead of plain text crashes
function errorHtml(title, message) {
  const html = `
    <html>
      <body style="font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background-color: #f8fafc; margin: 0;">
        <div style="background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); text-align: center; max-width: 400px; border-top: 4px solid #ef4444;">
          <div style="font-size: 50px; margin-bottom: 10px;">⚠️</div>
          <h1 style="color: #ef4444; margin-top: 0;">${title}</h1>
          <p style="font-size: 16px; color: #475569; line-height: 1.5;">${message}</p>
          <p style="color: #94a3b8; margin-top: 30px; font-size: 14px;">Please contact the administrator or try again.</p>
        </div>
      </body>
    </html>
  `;
  return new NextResponse(html, { status: 400, headers: { 'Content-Type': 'text/html' } });
}

export async function GET(req) {
  try {
    // 1. Grab the IDs and the new Status from the URL the email generated
    const { searchParams } = new URL(req.url);
    const sheetId = searchParams.get("sheetId");
    const rowId = searchParams.get("rowId");
    const colId = searchParams.get("colId");
    const status = searchParams.get("status");
    const isReport = searchParams.get("isReport") === "true";

    // 🔒 SECURITY CHECK 1: Ensure all parameters exist
    if (!sheetId || !rowId || !colId || !status) {
      return errorHtml("Missing Information", "The link appears to be broken or incomplete.");
    }

    // 🔒 SECURITY CHECK 2: Prevent Database Injection (Only allow specific words)
    const allowedStatuses = ["Cleared", "Pending"];
    if (!allowedStatuses.includes(status)) {
      return errorHtml("Invalid Action", "That status update is not allowed.");
    }

    await connectMongo();

    // 2. Find the tracker sheet
    const sheet = await Tracker.findById(sheetId);
    if (!sheet) {
      return errorHtml("Database Error", "Project Tracker database not found.");
    }

    // 3. Find the exact row
    const rowIndex = sheet.rows.findIndex(r => r.id.toString() === rowId);
    if (rowIndex === -1) {
      return errorHtml("Not Found", "We couldn't find this specific project row.");
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
          <div style="background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); text-align: center; max-width: 400px; border-top: 4px solid ${status === 'Cleared' ? '#10b981' : '#f59e0b'};">
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
    return errorHtml("System Error", "An unexpected error occurred while saving to the database.");
  }
}