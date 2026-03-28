import { NextResponse } from "next/server";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req) {
  try {
    const { to, project, sheetName, type } = await req.json();

    const htmlContent = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 30px; border-radius: 8px; border: 1px solid #e2e8f0; max-width: 600px; margin: 0 auto; background-color: #ffffff;">
      
      <div style="border-bottom: 2px solid #2563eb; padding-bottom: 15px; margin-bottom: 20px;">
        <h2 style="color: #1e293b; margin: 0; font-size: 20px;">Official Project Notification</h2>
      </div>
      
      <p style="font-size: 16px; color: #334155; line-height: 1.6; margin-bottom: 25px;">
        ${type}
      </p>
      
      <div style="background-color: #f8fafc; padding: 15px; border-radius: 6px; border-left: 4px solid #3b82f6;">
        <p style="font-size: 15px; color: #475569; margin: 0;"><strong>Project Reference:</strong> ${project}</p>
      </div>
      
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0 20px 0;" />
      <p style="font-size: 12px; color: #94a3b8; text-align: center; margin: 0;">
        This is an automated official notification.<br/>
        Ministry of Finance, Royal Government of Bhutan.
      </p>

    </div>
    `;

    const data = await resend.emails.send({
      from: "Project Tracker <onboarding@resend.dev>",
      to: [to],
      subject: `Project Update: ${project}`,
      html: htmlContent,
    });

    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
