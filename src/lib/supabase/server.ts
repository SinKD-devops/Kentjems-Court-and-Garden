import { createClient } from "@supabase/supabase-js";

/**
 * Read-only Supabase client for server components.
 *
 * Uses the publishable key, which is the same key the browser gets. Every
 * table it touches is guarded by row level security, and availability comes
 * from views that expose ranges and counts but never identities. The secret
 * key is deliberately absent here — nothing on the availability path needs
 * to bypass RLS, and importing it would make that far too easy to do by
 * accident later.
 */
export function createReadClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase is not configured. Copy .env.example to .env.local and fill in " +
        "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
