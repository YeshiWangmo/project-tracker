import { NextResponse } from 'next/server';
import { Resend } from 'resend';

// Initialize Resend with your secret key
const resend = new Resend(process.env.RESEND_API_KEY);

// 1. THIS POST FUNCTION ACTUALLY SENDS THE EMAIL!
export async function POST(request) {
  try {
    // Grab the data sent over by your invisible cron timer
    const { to, project, sheetName, type } = await request.json();

    // Tell Resend to fire the email
    const data = await resend.emails.send({
      from: 'onboarding@resend.dev', // ⚠️ MUST be this exact address on the free tier!
      to: [to], // ⚠️ MUST be your own email address while in the Resend sandbox!
      subject: `Action Required: ${project} - ${type}`,
      html: `
        <div style="font-family: sans-serif; padding: 20px; color: #333;">
          <h2 style="color: #2563eb;">Project Reminder</h2>
          <p><strong>Project Name:</strong> ${project}</p>
          <p><strong>Sheet:</strong> ${sheetName}</p>
          <p><strong>Alert Type:</strong> ${type}</p>
          <hr style="border: 1px solid #eee; margin: 20px 0;" />
          <p>Please log in to the AdminHub to review and update this project.</p>
        </div>
      `
    });

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("Resend Error:", error);
    return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
  }
}

// 2. THIS GET FUNCTION SHOWS THE SUCCESS SCREEN WHEN LINKS ARE CLICKED
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('projectId');
  const phaseId = searchParams.get('phaseId');
  const action = searchParams.get('action'); // "cleared"

  if (!projectId || !phaseId || action !== 'cleared') {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    return new NextResponse(`
      <html>
        <body style="font-family: sans-serif; text-align: center; padding-top: 50px; background-color: #f8fafc;">
          <h1 style="color: #22c55e;">✅ Status Updated!</h1>
          <p>The project phase has been successfully marked as Cleared.</p>
          <p>You can close this window.</p>
        </body>
      </html>
    `, { headers: { 'Content-Type': 'text/html' } });

  } catch (error) {
    return NextResponse.json({ error: "Failed to update status" }, { status: 500 });
  }
}