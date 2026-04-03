import { NextResponse } from "next/server";
import connectMongo from "../../../lib/mongodb";
import Tracker from "../../../models/Tracker";
import { currentUser } from "@clerk/nextjs/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await connectMongo();
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userEmail = user.emailAddresses[0]?.emailAddress || "";
    // 🚨 MULTIPLE ADMIN CHECK FOR GET
    const adminEmails = process.env.NEXT_PUBLIC_ADMIN_EMAIL ? process.env.NEXT_PUBLIC_ADMIN_EMAIL.split(",").map(e => e.trim()) : [];
    const isAdmin = adminEmails.includes(userEmail);

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
    // 🚨 MULTIPLE ADMIN CHECK FOR POST
    const adminEmails = process.env.NEXT_PUBLIC_ADMIN_EMAIL ? process.env.NEXT_PUBLIC_ADMIN_EMAIL.split(",").map(e => e.trim()) : [];
    const isAdmin = adminEmails.includes(userEmail);
    const incomingData = await req.json();
    
    if (!incomingData || (Array.isArray(incomingData) && incomingData.length === 0)) {
      return NextResponse.json({ success: true, message: "No data to save." });
    }

    const dataToSave = Array.isArray(incomingData) ? incomingData : [incomingData];
    const savedSheets = [];

    for (const sheet of dataToSave) {
      const uniqueId = sheet.id ? sheet.id : Date.now() + Math.floor(Math.random() * 1000);
      const existingSheet = await Tracker.findOne({ id: uniqueId });

      if (existingSheet && !isAdmin && existingSheet.userId !== user.id) {
        return NextResponse.json({ error: "Forbidden: you can only modify your own sheets." }, { status: 403 });
      }

      const { _id, ...updateData } = sheet;
      updateData.id = uniqueId;
      updateData.userId = existingSheet?.userId || user.id;
      updateData.userEmail = existingSheet?.userEmail || userEmail;
      
      updateData.historyLogs = existingSheet?.historyLogs || [];

      const savedSheet = await Tracker.findOneAndUpdate(
        { id: uniqueId }, 
        { $set: updateData }, 
        { upsert: true, new: true } 
      );
      savedSheets.push(savedSheet);
    }
    return NextResponse.json({ success: true, sheets: savedSheets });
  } catch (error) {
    console.error("Tracker Save Error:", error);
    return NextResponse.json({ error: "Failed to save tracker data", details: error.message }, { status: 500 });
  }
}