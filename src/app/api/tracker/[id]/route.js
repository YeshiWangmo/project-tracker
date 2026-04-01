import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import connectMongo from "../../../../lib/mongodb";
import Tracker from "../../../../models/Tracker";

function clearReminderKeysForChangedDates(existingRows = [], incomingRows = []) {
  const existingRowsById = new Map(existingRows.map((row) => [String(row.id), row]));

  return incomingRows.map((row) => {
    const existingRow = existingRowsById.get(String(row.id));
    if (!existingRow || !Array.isArray(row.sentReminderKeys)) {
      return row;
    }

    let filteredKeys = [...row.sentReminderKeys];
    const dateGroups = [
      { type: "due", previous: existingRow.dueDates || {}, next: row.dueDates || {} },
      { type: "report", previous: existingRow.reportDates || {}, next: row.reportDates || {} },
    ];

    for (const group of dateGroups) {
      const colIds = new Set([
        ...Object.keys(group.previous || {}),
        ...Object.keys(group.next || {}),
      ]);

      for (const colId of colIds) {
        const previousValue = group.previous?.[colId] || "";
        const nextValue = group.next?.[colId] || "";

        if (previousValue !== nextValue) {
          filteredKeys = filteredKeys.filter(
            (key) => !key.startsWith(`${group.type}:${colId}:`)
          );
        }
      }
    }

    return {
      ...row,
      sentReminderKeys: filteredKeys,
    };
  });
}

async function authorizeUser(sheetId) {
  const user = await currentUser();
  if (!user) {
    return { authorized: false, error: "Unauthorized", status: 401 };
  }

  const userEmail = user.emailAddresses[0]?.emailAddress || "";
  const adminEmail = process.env.ADMIN_EMAIL;
  const sheet = await Tracker.findById(sheetId);

  if (!sheet) {
    return { authorized: false, error: "Project not found", status: 404 };
  }

  if (userEmail === adminEmail || sheet.userId === user.id) {
    return { authorized: true, sheet };
  }

  return {
    authorized: false,
    error: "Forbidden: You do not own this project",
    status: 403,
  };
}

export async function PUT(req, { params }) {
  try {
    await connectMongo();
    const { id } = await params;

    const auth = await authorizeUser(id);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await req.json();
    const { _id, userId, userEmail, ...updateData } = body;
    const sanitizedRows = Array.isArray(updateData.rows)
      ? clearReminderKeysForChangedDates(auth.sheet.rows || [], updateData.rows)
      : updateData.rows;

    const updatedSheet = await Tracker.findByIdAndUpdate(
      id,
      {
        $set: {
          ...updateData,
          rows: sanitizedRows,
          userId: auth.sheet.userId,
          userEmail: auth.sheet.userEmail,
        },
      },
      { new: true }
    );

    return NextResponse.json({ success: true, sheet: updatedSheet });
  } catch (error) {
    console.error("Failed to update project:", error);
    return NextResponse.json({ error: "Failed to update project" }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  try {
    await connectMongo();
    const { id } = await params;

    const auth = await authorizeUser(id);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    await Tracker.findByIdAndDelete(id);

    return NextResponse.json({
      success: true,
      message: "Project deleted permanently",
    });
  } catch (error) {
    console.error("Failed to delete project:", error);
    return NextResponse.json({ error: "Failed to delete project" }, { status: 500 });
  }
}
