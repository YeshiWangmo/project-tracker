import "./globals.css";

export const metadata = {
  title: "Project Tracker Pro",
  description: "Track projects and fees easily",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      {/* Add suppressHydrationWarning here so Next.js ignores Grammarly! */}
      <body suppressHydrationWarning className="bg-gray-50 text-black antialiased">
        {children}
      </body>
    </html>
  );
}
