import { NextResponse } from "next/server";
import connectMongo from "../../../lib/mongodb";
import History from "../../../models/History";

// Tells Vercel not to cache this API route so you always get live data
export const dynamic = "force-dynamic";

// Handles GET requests (Fetching the history)
export async function GET() {
  try {
    await connectMongo();
    // Fetch all history records, sorted by newest first
    const historyData = await History.find({}).sort({ createdAt: -1 });
    return NextResponse.json(historyData, { status: 200 });
  } catch (error) {
    console.error("GET History Error:", error);
    return NextResponse.json({ error: "Failed to fetch history" }, { status: 500 });
  }
}

// Handles POST requests (Adding new history)
export async function POST(req) {
  try {
    await connectMongo();
    const body = await req.json();

    let savedHistory;

    if (Array.isArray(body)) {
      await History.deleteMany({});
      savedHistory = await History.insertMany(body);
    } else {
      delete body._id;
      savedHistory = await History.create(body);
    }

    return NextResponse.json(savedHistory, { status: 201 });
  } catch (error) {
    console.error("POST History Error:", error);
    return NextResponse.json({ error: "Failed to create history" }, { status: 500 });
  }
}
