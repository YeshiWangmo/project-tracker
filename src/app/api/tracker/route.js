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

    // SMART SAVE: Update existing or create new. NO DELETIONS ALLOWED.
    for (const sheet of dataToSave) {
      
      // Safety Check: If the frontend forgot to give this sheet a unique ID, make one!
      const uniqueId = sheet.id ? sheet.id : Date.now() + Math.floor(Math.random() * 1000);

      // Strip out the internal MongoDB _id so it doesn't cause update conflicts
      const { _id, ...updateData } = sheet;
      
      // Ensure the unique ID is saved
      updateData.id = uniqueId;

      // Find the specific project by its ID and update it safely
      await Tracker.findOneAndUpdate(
        { id: uniqueId }, 
        { $set: updateData }, 
        { upsert: true, new: true } 
      );
    }

    // 🛑 I HAVE COMPLETELY REMOVED THE `deleteMany` CLEANUP BLOCK HERE. 
    // MongoDB is now strictly forbidden from deleting your old sheets!
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Tracker Save Error:", error);
    return NextResponse.json({ error: "Failed to save tracker data", details: error.message }, { status: 500 });
  }
}