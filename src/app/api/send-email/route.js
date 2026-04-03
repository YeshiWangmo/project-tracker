import { NextResponse } from "next/server";
import nodemailer from "nodemailer";

export async function POST(req) {
  try {
    const { to, project, sheetName, type, role, baseUrl } = await req.json();

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });

    // 🎨 CLEAN, SIMPLE DESIGN EXACTLY LIKE YOUR SCREENSHOT
    let emailHtml = `
      <div style="font-family: Arial, sans-serif; font-size: 14px; color: #333; max-width: 600px;">
        <p>Dear Project Manager,</p>
    `;

    // 🎯 INTERACTIVE BUTTON FOR PAYERS
    if (role === "payer") {
      const siteUrl = baseUrl || "https://project-tracker-nine-phi.vercel.app";
      emailHtml += `
        <p>This is a reminder that the <strong>${type}</strong> for <strong>${project}</strong> is currently pending.</p>
        <p>Please click the button below to update the status once completed.</p>
        
        <p style="margin-top: 20px; margin-bottom: 25px;">
          <a href="${siteUrl}" style="background-color: #2563eb; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
            Update Project Status
          </a>
        </p>
      `;
    } else {
      // FOR RECEIVERS
      emailHtml += `
        <p>This is an informational update that the <strong>${type}</strong> for <strong>${project}</strong> has been processed or updated.</p>
        <p>No direct action is required from you at this time.</p>
        <br/>
      `;
    }

    // SIGNATURE
    emailHtml += `
        <p style="margin-bottom: 5px;">Thank you,</p>
        <p style="margin-top: 0; font-weight: bold;">MoF Project Tracker</p>
      </div>
    `;

    const mailOptions = {
      from: `"MoF Project Tracker" <${process.env.GMAIL_USER}>`,
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