import { NextResponse } from "next/server";
import nodemailer from "nodemailer";

export async function POST(req) {
  try {
    const { to, project, sheetName, type, role, baseUrl } = await req.json();

    // Uses the same credentials as your background robot
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });

    let emailHtml = `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 10px;">
        <h2 style="color: #2563eb; margin-bottom: 5px;">MoF Project Tracker</h2>
        <p style="color: #64748b; font-size: 14px; margin-top: 0;">Automated Notification</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
        
        <p style="font-size: 16px;"><strong>Project:</strong> ${project}</p>
        <p style="font-size: 16px;"><strong>Tracker:</strong> ${sheetName}</p>
        <div style="background-color: #f8fafc; padding: 15px; border-left: 4px solid #3b82f6; margin: 20px 0; font-size: 16px;">
          ${type}
        </div>
    `;

    // INTERACTIVE BUTTON FOR PAYERS
    if (role === "payer") {
      const siteUrl = baseUrl || "https://project-tracker-nine-phi.vercel.app";
      emailHtml += `
        <p style="color: #d97706; font-weight: bold; margin-top: 30px;">Action Required:</p>
        <p>You have been assigned as the Payer/Action-taker for this task. Please click the button below to view the tracker and update the status once completed.</p>
        <a href="${siteUrl}" style="display: inline-block; background-color: #2563eb; color: #ffffff; padding: 12px 24px; text-decoration: none; font-weight: bold; border-radius: 5px; margin-top: 10px;">
          Update Project Status
        </a>
      `;
    } else {
      // FOR RECEIVERS
      emailHtml += `
        <p style="color: #64748b; margin-top: 30px; font-size: 14px;">This is an informational message. No direct action is required from you at this time.</p>
      `;
    }

    emailHtml += `
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0 20px 0;" />
        <p style="font-size: 12px; color: #94a3b8; text-align: center;">This is an automated message from the Ministry of Finance, Bhutan.</p>
      </div>
    `;

    const mailOptions = {
      from: process.env.GMAIL_USER,
      to,
      subject: `MoF Update: ${project} - ${sheetName}`,
      html: emailHtml,
    };

    await transporter.sendMail(mailOptions);
    return NextResponse.json({ success: true });

  } catch (error) {
    console.error("Email Error:", error);
    return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
  }
}