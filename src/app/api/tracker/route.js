import { NextResponse } from "next/server";
import connectMongo from "../../../lib/mongodb";
import Tracker from "../../../models/Tracker";
import { currentUser } from "@clerk/nextjs/server";

// Force fresh data every time
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await connectMongo();
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userEmail = user.emailAddresses[0]?.emailAddress || "";
    const adminEmail = process.env.ADMIN_EMAIL;
    const isAdmin = userEmail === adminEmail;

    const sheets = isAdmin
      ? await Tracker.find({}).sort({ createdAt: -1 })
      : await Tracker.find({ userId: user.id }).sort({ createdAt: -1 });

    return NextResponse.json(sheets);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch tracker data" }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    await connectMongo();
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userEmail = user.emailAddresses[0]?.emailAddress || "";
    const adminEmail = process.env.ADMIN_EMAIL;
    const isAdmin = userEmail === adminEmail;
    const incomingData = await req.json();
    
    // Safety Lock
    if (!incomingData || (Array.isArray(incomingData) && incomingData.length === 0)) {
      return NextResponse.json({ success: true, message: "No data to save." });
    }

    const dataToSave = Array.isArray(incomingData) ? incomingData : [incomingData];

    // SMART SAVE: Update existing or create new. NO DELETIONS ALLOWED.
    const savedSheets = [];

    for (const sheet of dataToSave) {
      
      // Safety Check: If the frontend forgot to give this sheet a unique ID, make one!
      const uniqueId = sheet.id ? sheet.id : Date.now() + Math.floor(Math.random() * 1000);
      const existingSheet = await Tracker.findOne({ id: uniqueId });

      if (existingSheet && !isAdmin && existingSheet.userId !== user.id) {
        return NextResponse.json(
          { error: "Forbidden: you can only modify your own sheets." },
          { status: 403 }
        );
      }

      // Strip out the internal MongoDB _id so it doesn't cause update conflicts
      const { _id, ...updateData } = sheet;
      
      // Ensure the unique ID is saved
      updateData.id = uniqueId;
      updateData.userId = existingSheet?.userId || user.id;
      updateData.userEmail = existingSheet?.userEmail || userEmail;

      // ==========================================
      // HISTORY LOG LOGIC: Detect Changes
      // ==========================================
      let newLogEntries = [];

      if (existingSheet && existingSheet.rows && updateData.rows) {
        // Create a quick lookup map of the old rows
        const oldRowsMap = {};
        existingSheet.rows.forEach(r => { oldRowsMap[r.id] = r; });

        // Compare new rows to old rows
        updateData.rows.forEach(newRow => {
          const oldRow = oldRowsMap[newRow.id];
          const projectName = newRow.project || "Unnamed Project";

          if (oldRow) {
            // 1. Check for Due Date changes
            if (newRow.dueDates) {
              Object.keys(newRow.dueDates).forEach(colId => {
                const oldDate = oldRow.dueDates[colId] || "None";
                const newDate = newRow.dueDates[colId] || "None";
                if (oldDate !== newDate) {
                  newLogEntries.push(`Date changed for '${projectName}': from ${oldDate} to ${newDate}`);
                }
              });
            }

            // 2. Check for Email changes
            if (newRow.emails) {
              Object.keys(newRow.emails).forEach(colId => {
                const oldEmail = oldRow.emails[colId] || "None";
                const newEmail = newRow.emails[colId] || "None";
                if (oldEmail !== newEmail) {
                  newLogEntries.push(`Email changed for '${projectName}': from ${oldEmail} to ${newEmail}`);
                }
              });
            }
          }
        });
      }

      // If we found changes, append them to the historyLogs array in the database
      if (newLogEntries.length > 0) {
        const logObject = {
          timestamp: new Date().toISOString(),
          editedBy: userEmail,
          changes: newLogEntries
        };
        // Preserve existing logs and add the new one
        updateData.historyLogs = [...(existingSheet.historyLogs || []), logObject];
      } else {
        // Keep the old logs if nothing changed
        updateData.historyLogs = existingSheet?.historyLogs || [];
      }
      // ==========================================

      // Find the specific project by its ID and update it safely
      const savedSheet = await Tracker.findOneAndUpdate(
        { id: uniqueId }, 
        { $set: updateData }, 
        { upsert: true, new: true } 
      );
      savedSheets.push(savedSheet);
    }

    // 🛑 I HAVE COMPLETELY REMOVED THE `deleteMany` CLEANUP BLOCK HERE. 
    // MongoDB is now strictly forbidden from deleting your old sheets!
    
    return NextResponse.json({ success: true, sheets: savedSheets });
  } catch (error) {
    console.error("Tracker Save Error:", error);
    return NextResponse.json({ error: "Failed to save tracker data", details: error.message }, { status: 500 });
  }
}