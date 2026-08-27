import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kentjems Court and Garden",
  description: "Book the court by the hour or the garden for an event, in Cebu.",
  applicationName: "Kentjems",
  appleWebApp: {
    capable: true,
    title: "Kentjems",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#edf2ee",
  // The app is a phone-first PWA; letting it scale breaks the fixed bars.
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
