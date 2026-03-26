import { NextResponse } from "next/server";
import connectMongo from "../../../lib/mongodb";
import Tracker from "../../../models/Tracker";

// Force fresh data every time
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await connectMongo();
    const sheets = await Tracker.find({});
    return NextResponse.json(sheets);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch tracker data" }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    await connectMongo();
    const incomingData = await req.json();
    
    // Safety Lock
    if (!incomingData || (Array.isArray(incomingData) && incomingData.length === 0)) {
      return NextResponse.json({ success: true, message: "No data to save." });
    }

    const dataToSave = Array.isArray(incomingData) ? incomingData : [incomingData];
    const activeIds = [];

    // SMART SAVE: Update each sheet individually instead of wiping the whole database!
    for (const sheet of dataToSave) {
      activeIds.push(sheet.id);
      
      // Strip out the internal MongoDB _id so it doesn't cause update conflicts
      const { _id, ...updateData } = sheet;

      // Find the specific project by your custom 'id' and update it safely
      await Tracker.findOneAndUpdate(
        { id: sheet.id }, 
        { $set: updateData }, 
        { upsert: true, new: true } // If it doesn't exist yet, create it!
      );
    }

    // Clean up: Only delete sheets that the user actually clicked "Delete" on
    if (activeIds.length > 0) {
      await Tracker.deleteMany({ id: { $nin: activeIds } });
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Tracker Save Error:", error);
    return NextResponse.json({ error: "Failed to save tracker data", details: error.message }, { status: 500 });
  }
}