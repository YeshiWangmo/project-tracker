import { NextResponse } from "next/server";
import connectMongo from "../../../lib/mongodb";
import User from "../../../models/User";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await connectMongo();
    
    // NUKE BUTTON: This deletes all users in the database
    // await User.deleteMany({}); 
    
    const users = await User.find({});
    return NextResponse.json(users);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    await connectMongo();
    const users = await req.json();
    await User.deleteMany({});
    if (users.length > 0) await User.insertMany(users);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Failed to save users" }, { status: 500 });
  }
}