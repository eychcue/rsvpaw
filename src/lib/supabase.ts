import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;

// Server-only client (service key) — never import from client components.
export const db = () =>
  createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// Browser client (anon key) for realtime reads on the dashboard.
export const browserDb = () => createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

export async function logActivity(userId: string, kind: string, message: string, eventId?: string) {
  await db().from("activity").insert({ user_id: userId, event_id: eventId ?? null, kind, message });
}
