import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

export const metadata = {
  title: "Project Tracker Pro",
  description: "Track projects and fees easily",
};

export default function RootLayout({ children }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body suppressHydrationWarning className="bg-gray-50 text-black antialiased">
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
