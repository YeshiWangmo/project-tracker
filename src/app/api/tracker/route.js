import { NextResponse } from "next/server";
import connectMongo from "../../../lib/mongodb";
import Tracker from "../../../models/Tracker";

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
    const sheets = await req.json();
    
    // Wipe the old data and replace it with your newly typed data
    await Tracker.deleteMany({});
    if (sheets && sheets.length > 0) {
      await Tracker.insertMany(sheets);
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Tracker Save Error:", error);
    return NextResponse.json({ error: "Failed to save tracker data" }, { status: 500 });
  }
}