"use client";

import { useState } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/browser";

/**
 * Turns on the expiry reminder.
 *
 * Permission is requested from a real tap, never on page load. A browser only
 * lets you ask once, and a prompt that appears unprompted is denied by reflex
 * — which would permanently cost the customer the one warning that matters.
 *
 * The button is honest about what it is for: a reminder before the request
 * expires, not "updates".
 */
export function NotifyToggle({ publicKey }: { publicKey: string }) {
  const [state, setState] = useState<"idle" | "working" | "on" | "blocked" | "error">("idle");

  async function enable() {
    setState("working");

    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setState("blocked");
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState("blocked");
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const json = subscription.toJSON();
      const supabase = createSupabaseBrowser();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { error } = await supabase.from("push_subscriptions").upsert(
        {
          user_id: user.id,
          endpoint: subscription.endpoint,
          p256dh: json.keys?.p256dh ?? "",
          auth: json.keys?.auth ?? "",
        },
        { onConflict: "endpoint" },
      );
      if (error) throw error;

      setState("on");
    } catch (error) {
      console.error("Could not enable reminders:", error);
      setState("error");
    }
  }

  if (state === "on") {
    return (
      <p className="rounded-xl bg-tint px-3.5 py-2.5 text-[12.5px] font-semibold text-green-deep">
        Reminders on. We&rsquo;ll warn you 10 minutes before a request expires.
      </p>
    );
  }

  if (state === "blocked") {
    return (
      <p className="rounded-xl bg-sunken px-3.5 py-2.5 text-[12.5px] font-semibold text-soft">
        Notifications are off for this site. Turn them on in your browser settings if you
        want the expiry reminder.
      </p>
    );
  }

  return (
    <button
      type="button"
      onClick={enable}
      disabled={state === "working"}
      className="rounded-xl border border-tint-line bg-tint px-3.5 py-2.5 text-[12.5px] font-bold text-green-deep disabled:opacity-60"
    >
      {state === "working"
        ? "Turning on…"
        : state === "error"
          ? "Could not turn on — tap to retry"
          : "Remind me before my request expires"}
    </button>
  );
}

/**
 * VAPID keys are base64url; PushManager wants raw bytes.
 *
 * Returns an ArrayBuffer rather than a Uint8Array because the DOM types
 * require a buffer backed by ArrayBuffer specifically, which a Uint8Array is
 * not guaranteed to be.
 */
function urlBase64ToUint8Array(base64: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const buffer = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) view[i] = raw.charCodeAt(i);
  return buffer;
}
