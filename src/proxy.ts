import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase session on every navigation.
 *
 * Server components can read cookies but cannot write them, so without this
 * an expired access token would never be renewed and a signed-in customer
 * would be silently logged out mid-booking.
 */
export async function proxy(request: NextRequest) {
  const response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  // Missing configuration must not take the whole site down. This runs
  // before routing, so throwing here turns every request into a 500 —
  // including static pages, the 404, and the SMS hook. Skipping the refresh
  // instead leaves the site up and degrades only what needs a session, and
  // the page itself reports the misconfiguration in terms an operator can
  // act on.
  if (!url || !key) {
    console.error(
      "Supabase environment variables are missing; skipping session refresh. " +
        "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
    );
    return response;
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value, options } of list) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  try {
    await supabase.auth.getUser();
  } catch (error) {
    // A Supabase outage should not block someone from reading availability.
    console.error("Session refresh failed:", error);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp)$).*)"],
};
