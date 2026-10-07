import { NextResponse, after } from "next/server";
import { discoverFor, swipe, sendReminders, checkApprovals, cancel, getOrCreateUser } from "@/lib/rsvpaw";
import { db } from "@/lib/supabase";

export const maxDuration = 300;

export async function POST(req: Request) {
  const { action, userId, eventId, dir, phone, profile } = await req.json();
  try {
    switch (action) {
      case "discover": return NextResponse.json(await discoverFor(userId));
      case "swipe": { const p = swipe(userId, eventId, dir); after(() => p); } return NextResponse.json({ ok: true });
      case "remind": return NextResponse.json({ sent: await sendReminders(userId, 24 * 30) });
      case "check": await checkApprovals(userId); return NextResponse.json({ ok: true });
      case "cancel": after(() => cancel(userId, eventId)); return NextResponse.json({ ok: true });
      case "signup": {
        const { user } = await getOrCreateUser(phone);
        if (profile) await db().from("users").update(profile).eq("id", user.id);
        return NextResponse.json({ user });
      }
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
