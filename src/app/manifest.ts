import type { MetadataRoute } from "next";

/**
 * Web app manifest.
 *
 * `display: standalone` is what turns an installed shortcut into something
 * that looks like an app rather than a browser tab — and on iOS it is also
 * the precondition for web push working at all.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kentjems Court and Garden",
    short_name: "Kentjems",
    description: "Book the court by the hour or the garden for an event.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#edf2ee",
    theme_color: "#edf2ee",
    lang: "en-PH",
    categories: ["sports", "lifestyle"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Without a maskable icon Android crops the square into a circle and
      // slices the corners off the mark.
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      { name: "My bookings", url: "/my" },
      { name: "Today at the counter", url: "/admin" },
    ],
  };
}
