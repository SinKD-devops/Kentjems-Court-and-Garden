"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * Registers the service worker and offers to install the app.
 *
 * Deliberately not rendered on the landing page. It appears on the bookings
 * screen, and only once somebody has actually booked something — asking a
 * stranger to install an app before they know what it does is how install
 * prompts get dismissed for good.
 *
 * Android and iOS need entirely different treatment. Chrome fires
 * `beforeinstallprompt` and lets us show a real install button. Safari has no
 * such event and never will, so iOS gets instructions and a picture of where
 * to tap.
 */

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED_KEY = "kentjems.install.dismissed";

/**
 * Whether to offer installation, and how. This is browser state that never
 * changes during a visit, so it is read through useSyncExternalStore rather
 * than assigned in an effect — which also keeps the server render honest by
 * returning "none" there.
 */
type Offer = "none" | "ios";

const noopSubscribe = () => () => {};

function readOffer(): Offer {
  const installed =
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in window.navigator &&
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true);
  if (installed) return "none";

  try {
    if (localStorage.getItem(DISMISSED_KEY) === "1") return "none";
  } catch {
    // Private browsing can throw on access; treat as not dismissed.
  }

  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isSafari =
    /safari/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);

  return isIos && isSafari ? "ios" : "none";
}

export function InstallPrompt() {
  const offer = useSyncExternalStore(noopSubscribe, readOffer, () => "none" as Offer);
  const [deferred, setDeferred] = useState<InstallEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      // Suppress Chrome's own banner so the offer appears where we choose.
      event.preventDefault();
      setDeferred(event as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const showIosHelp = offer === "ios";
  const hidden = dismissed || (!showIosHelp && !deferred);

  function dismiss() {
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      /* private browsing */
    }
    setDismissed(true);
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
    setDismissed(true);
  }

  if (hidden) return null;

  return (
    <section className="flex flex-col gap-2 rounded-2xl border border-tint-line bg-tint px-4 py-3.5">
      <p className="text-[13.5px] font-bold text-green-deep">Add Kentjems to your phone</p>

      {showIosHelp ? (
        <>
          <p className="text-[12.5px] leading-relaxed text-green-deep">
            Tap the Share button{" "}
            <ShareIcon /> at the bottom of Safari, then choose{" "}
            <b>Add to Home Screen</b>.
          </p>
          <p className="text-[11.5px] leading-relaxed text-green-deep/80">
            Once it&rsquo;s on your home screen we can text you less — the app can
            remind you before a booking expires.
          </p>
        </>
      ) : (
        <p className="text-[12.5px] leading-relaxed text-green-deep">
          Open it from your home screen like an app, and get a reminder before your
          request expires.
        </p>
      )}

      <div className="flex gap-2 pt-0.5">
        {deferred && (
          <button
            type="button"
            onClick={install}
            className="flex-1 rounded-full bg-green py-2.5 text-[13px] font-bold text-white"
          >
            Install
          </button>
        )}
        <button
          type="button"
          onClick={dismiss}
          className="flex-1 rounded-full border border-tint-line py-2.5 text-[13px] font-semibold text-green-deep"
        >
          Not now
        </button>
      </div>
    </section>
  );
}

function ShareIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="inline-block size-[15px] translate-y-[2px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 15V3" />
      <path d="m8 7 4-4 4 4" />
      <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  );
}

/** Registers the service worker. Separate so it can run on every page. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // Registration failing must never break the page.
    navigator.serviceWorker
      .register("/sw.js")
      .catch((error) => console.error("Service worker registration failed:", error));
  }, []);

  return null;
}
