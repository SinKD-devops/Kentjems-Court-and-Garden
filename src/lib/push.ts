import "server-only";

import webpush from "web-push";

/**
 * Web push.
 *
 * Push carries the notifications that are not worth an SMS — chiefly the
 * ten-minute expiry warning, which would otherwise cost a peso per request on
 * a message nobody has paid for yet.
 *
 * On iOS push only works once the app is on the home screen, which is exactly
 * why the install prompt promises this. Anything where money has already
 * moved still goes by SMS, because it must arrive whether or not the customer
 * ever installed anything.
 */

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushMessage {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

let configured = false;

function configure(): boolean {
  if (configured) return true;

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:operator@example.com";

  if (!publicKey || !privateKey) return false;

  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export type PushResult = "sent" | "expired" | "failed" | "unconfigured";

export async function sendPush(target: PushTarget, message: PushMessage): Promise<PushResult> {
  if (!configure()) return "unconfigured";

  try {
    await webpush.sendNotification(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      JSON.stringify(message),
      { TTL: 600 },
    );
    return "sent";
  } catch (error) {
    // 404 and 410 mean the browser threw the subscription away — the app was
    // uninstalled, or permission revoked. Those rows should be deleted rather
    // than retried forever.
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) return "expired";
    console.error("Push failed:", status, (error as Error).message);
    return "failed";
  }
}
