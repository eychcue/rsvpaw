// RSVPaw iMessage bot: Photon (spectrum-ts) <-> RSVPaw core.
import { Spectrum, contact, attachment } from "spectrum-ts";
import { VCARD } from "./vcard";
import { imessage } from "spectrum-ts/providers/imessage";
import { db } from "../src/lib/supabase";
import { handleInbound, handleReaction, sendReminders, checkApprovals } from "../src/lib/rsvpaw";

const app = await Spectrum({
  projectId: process.env.PHOTON_PROJECT_ID!,
  projectSecret: process.env.PHOTON_PROJECT_SECRET!,
  providers: [imessage.config()],
});
const im = imessage(app);
console.log("🐾 RSVPaw bot online");

// Outbox → iMessage (guarded so slow sends don't double-send)
let flushing = false;
setInterval(async () => {
  if (flushing) return;
  flushing = true;
  try { await flush(); } finally { flushing = false; }
}, 2000);

async function flush() {
  const { data } = await db().from("outbox").select("*").is("sent_at", null).order("id").limit(10);
  for (const m of data ?? []) {
    try {
      const space = await im.space.create(m.phone);
      const sent = await space.send(m.body);
      await db().from("outbox").update({ sent_at: new Date().toISOString(), message_id: sent?.id ?? null }).eq("id", m.id);
      console.log("→", m.phone, m.body.slice(0, 60));
    } catch (e: any) {
      await db().from("outbox").update({ sent_at: new Date().toISOString(), error: String(e?.message ?? e).slice(0, 300) }).eq("id", m.id);
      console.error("send failed", m.phone, e?.message);
    }
  }
}

// Reminders + approval checks every 5 min
setInterval(async () => {
  const { data: users } = await db().from("users").select("id");
  for (const u of users ?? []) {
    try { await sendReminders(u.id); await checkApprovals(u.id); } catch (e) { console.error(e); }
  }
}, 5 * 60_000);

// Inbound
const pending = new Map<string, { parts: string[]; space: any; timer: any }>();
for await (const [space, msg] of app.messages) {
  if (msg.content.type === "reaction" && msg.sender?.id) {
    const { emoji, target } = msg.content as any;
    console.log("← tapback", msg.sender.id, emoji, target?.id);
    try {
      const reply = await handleReaction(msg.sender.id, emoji, target?.id, target?.content?.text);
      if (reply) await space.send(reply);
    } catch (e) { console.error(e); }
    continue;
  }
  if (msg.content.type !== "text" || !msg.sender?.id) continue;
  // iMessage splits links etc. into separate bubbles; coalesce bursts per sender
  const from = msg.sender.id;
  const buf = pending.get(from) ?? { parts: [] as string[], space, timer: undefined as any };
  buf.parts.push(msg.content.text);
  buf.space = space;
  clearTimeout(buf.timer);
  buf.timer = setTimeout(() => { pending.delete(from); handle(from, buf.parts.join("\n"), buf.space); }, 4000);
  pending.set(from, buf);
  console.log("←", from, msg.content.text);
}

async function handle(from: string, body: string, space: any) {
  try {
    await space.responding(async () => {
      const { reply, welcome } = await handleInbound(from, body);
      if (reply) await space.send(reply);
      if (welcome) await sendCard(space);
    });
  } catch (e: any) {
    console.error(e);
    await space.send("😵 Something broke on my end — try again in a sec.");
  }
}

// Our own branded contact card (shared Photon lines can't carry a name)
async function sendCard(space: any) {
  try { await space.send(contact(VCARD)); return; } catch (e: any) { console.error("contact()", e?.message); }
  try {
    await space.send(attachment(Buffer.from(VCARD), { name: "RSVPaw.vcf", mimeType: "text/vcard" }));
  } catch (e: any) { console.error("vcf attachment", e?.message); }
}
