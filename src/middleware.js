import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// 1. Define routes that do NOT need a login
const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)", 
  "/sign-up(.*)", 
  "/api/cron(.*)", 
  "/api/update-status(.*)" // CRITICAL: Allows the email buttons to work without logging in
]);

export default clerkMiddleware(async (auth, req) => {
  // 2. Only protect the route if it is NOT public
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals, static files, and completely hide our automated APIs from Clerk
    '/((?!_next|api/cron|api/update-status|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes EXCEPT cron and update-status
    '/(api(?!/cron|/update-status)|trpc)(.*)',
  ],
};