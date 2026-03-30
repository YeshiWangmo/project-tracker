import { NextResponse } from "next/server";
import nodemailer from "nodemailer";

export async function POST(req) {
  try {
    const { to, project, sheetName, type, role, sheetId, rowId, colId, isReport, baseUrl } = await req.json();

    console.log(`\nPreparing email for: ${to}`);
    console.log(`   Role: ${role} | Sheet: ${sheetId} | Row: ${rowId} | Col: ${colId}`);

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });

    let actionButtons = "";

    if (role === "payer" && sheetId && rowId && colId) {
      console.log("   Payer detected and IDs found. Generating buttons!");

      const clearedLink = `${baseUrl}/api/update-status?sheetId=${sheetId}&rowId=${rowId}&colId=${colId}&status=Cleared&isReport=${isReport}`;
      const pendingLink = `${baseUrl}/api/update-status?sheetId=${sheetId}&rowId=${rowId}&colId=${colId}&status=Pending&isReport=${isReport}`;

      actionButtons = `
        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px dashed #cbd5e1;">
          <p style="font-size: 14px; color: #334155; margin-bottom: 15px;"><strong>Update the status directly:</strong></p>
          <a href="${clearedLink}" style="background-color: #10b981; color: white; padding: 12px 20px; text-decoration: none; border-radius: 6px; font-weight: bold; margin-right: 10px; display: inline-block;">Mark as Cleared</a>
          <a href="${pendingLink}" style="background-color: #f59e0b; color: white; padding: 12px 20px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Mark as Pending</a>
        </div>
      `;
    } else if (role === "payer") {
      console.log("   Warning: Payer detected, but missing an ID! Buttons hidden.");
    } else {
      console.log("   Receiver detected. No buttons needed.");
    }

    const mailOptions = {
      from: `"MoF Project Tracker" <${process.env.GMAIL_USER}>`,
      to: to,
      subject: `${project} - Tracker Update`,
      text: type,
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px; max-width: 600px;">
          <h2 style="color: #1e293b; margin-top: 0;">Project Update</h2>
          <p style="font-size: 16px; color: #334155;"><strong>Project:</strong> ${project}</p>
          <p style="font-size: 16px; color: #334155;"><strong>Message:</strong> ${type}</p>
          
          ${actionButtons}

          <hr style="margin: 20px 0; border: none; border-top: 1px solid #cbd5e1;" />
          <p style="font-size: 12px; color: #94a3b8;">
            This is an automated notification from the MoF Project Tracker (${sheetName}).
          </p>
        </div>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    return NextResponse.json({ success: true, messageId: info.messageId });
  } catch (error) {
    console.error("Nodemailer Error:", error);
    return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
  }
}
