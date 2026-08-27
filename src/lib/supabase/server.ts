import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

function credentials() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase is not configured. Copy .env.example to .env.local and fill in " +
        "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
    );
  }
  return { url, key };
}

/**
 * Anonymous client for the availability path.
 *
 * Availability is public and needs no session, so this skips cookies
 * entirely. Every table it can reach is guarded by RLS, and the two
 * availability views expose ranges and counts but never identities.
 */
export function createReadClient() {
  const { url, key } = credentials();
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Session-aware client for anything that acts as the signed-in person. */
export async function createSupabaseServer() {
  const { url, key } = credentials();
  const store = await cookies();

  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        // Server components cannot set cookies. Middleware refreshes the
        // session instead, so swallowing this is correct rather than lossy.
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          /* called from a server component */
        }
      },
    },
  });
}

export async function getCurrentUser() {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
