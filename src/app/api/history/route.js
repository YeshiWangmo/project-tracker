import { NextResponse } from "next/server";
import mongoose from "mongoose";
import History from "@/models/History"; // Adjust this path if your alias is different

// Helper function to ensure database connection
const connectDB = async () => {
  if (mongoose.connection.readyState >= 1) {
    return;
  }
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("MongoDB connected successfully");
  } catch (error) {
    console.error("MongoDB connection error:", error);
  }
};

// Tells Vercel not to cache this API route so you always get live data
export const dynamic = "force-dynamic";

// Handles GET requests (Fetching the history)
export async function GET() {
  try {
    await connectDB();
    // Fetch all history records, sorted by newest first
    const historyData = await History.find({}).sort({ createdAt: -1 });
    return NextResponse.json(historyData, { status: 200 });
  } catch (error) {
    console.error("GET History Error:", error);
    return NextResponse.json({ error: "Failed to fetch history" }, { status: 500 });
  }
}

// Handles POST requests (Adding new history)
export async function POST(request) {
  try {
    await connectDB();
    const body = await request.json();
    
    // Create the new history record in MongoDB
    const newHistory = await History.create(body);
    return NextResponse.json(newHistory, { status: 201 });
  } catch (error) {
    console.error("POST History Error:", error);
    return NextResponse.json({ error: "Failed to create history" }, { status: 500 });
  }
}