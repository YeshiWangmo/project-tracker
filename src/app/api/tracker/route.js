import { NextResponse } from "next/server";
import connectMongo from "../../../lib/mongodb";
import Tracker from "../../../models/Tracker";

// Forces Next.js to bypass the cache and fetch fresh live data every single time.
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
    
    // SAFETY LOCK: If the frontend sends nothing, do not wipe the database!
    if (!incomingData || (Array.isArray(incomingData) && incomingData.length === 0) || Object.keys(incomingData).length === 0) {
      return NextResponse.json({ success: true, message: "No data provided to save." });
    }

    // Force the incoming data to be an array so insertMany always works
    const dataToSave = Array.isArray(incomingData) ? incomingData : [incomingData];

    // Wipe old data ONLY because we know for a fact we have new data to replace it with
    await Tracker.deleteMany({});
    await Tracker.insertMany(dataToSave);
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Tracker Save Error:", error);
    return NextResponse.json({ error: "Failed to save tracker data", details: error.message }, { status: 500 });
  }
}