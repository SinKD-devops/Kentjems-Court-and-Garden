import type { Metadata, Viewport } from "next";
import { ServiceWorkerRegister } from "@/components/InstallPrompt";
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
  // iOS ignores the manifest icons entirely and looks for apple-touch-icon.
  // Safari will guess the conventional path, but declaring it is not something
  // to leave to a fallback when it decides what the home screen looks like.
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
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
      <body className="min-h-full">
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
