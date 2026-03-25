import { NextResponse } from 'next/server';
// Later, we will import your Database connection here

export async function GET(request) {
  // 1. Grab the info from the email link that the user clicked
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('projectId');
  const phaseId = searchParams.get('phaseId');
  const action = searchParams.get('action'); // "cleared"

  if (!projectId || !phaseId || action !== 'cleared') {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    // 2. THIS IS WHERE WE UPDATE THE DATABASE
    // Example: await Database.Projects.updateStatus(projectId, phaseId, "Cleared");

    // 3. Trigger the email to the "Receiver" letting them know it was cleared
    // await sendReceiverEmail(projectId, phaseId, "Cleared");

    // 4. Show a success screen to the Payer who clicked the link
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