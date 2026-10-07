// RSVPaw core: discover → score → suggest/auto-register → track → remind → cancel.
// Shared by the Next.js API routes and the iMessage bot.
import { db, logActivity } from "./supabase";
import { discoverLuma, getLumaEvent } from "./luma";
import { ask, createInstance, parseJson } from "./agent37";

export type User = {
  id: string; phone: string; name: string | null; email: string | null; company: string | null;
  role: string | null; linkedin: string | null; bio: string | null; interests: string | null;
  auto_join_threshold: number; agent37_instance_id: string | null; pending_action: any;
};

const fmtTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" }) : "TBD";

export async function text(user: Pick<User, "id" | "phone">, body: string, eventId?: string) {
  await db().from("outbox").insert({ user_id: user.id, phone: user.phone, body, event_id: eventId ?? null });
  await logActivity(user.id, "imessage_out", body);
}

export async function getUser(id: string) {
  const { data } = await db().from("users").select("*").eq("id", id).single();
  return data as User;
}

export async function getOrCreateUser(phone: string) {
  const { data } = await db().from("users").select("*").eq("phone", phone).maybeSingle();
  if (data) return { user: data as User, isNew: false };
  const { data: created, error } = await db().from("users").insert({ phone }).select("*").single();
  if (error) throw error;
  return { user: created as User, isNew: true };
}

async function instanceFor(user: User) {
  if (user.agent37_instance_id) return user.agent37_instance_id;
  // Demo owner reuses the pre-warmed computer (already logged in to Luma); everyone else gets their own.
  const id = (user.phone === process.env.MY_PHONE && process.env.AGENT37_DEFAULT_INSTANCE) || (await createInstance()).id;
  await db().from("users").update({ agent37_instance_id: id }).eq("id", user.id);
  await logActivity(user.id, "agent", `Provisioned Agent37 computer ${id}`);
  return id;
}

/** Ask the user's Agent37 agent to score events against their taste. */
async function scoreEvents(user: User, events: { id: string; name: string; host: string; description: string | null }[]) {
  const { data: history } = await db()
    .from("user_events").select("swipe, events(name, host)").eq("user_id", user.id).not("swipe", "is", null).limit(40);
  const liked = (history ?? []).filter((h: any) => h.swipe === "like").map((h: any) => `${h.events.name} (${h.events.host})`);
  const disliked = (history ?? []).filter((h: any) => h.swipe === "dislike").map((h: any) => `${h.events.name} (${h.events.host})`);

  const prompt = `You are RSVPaw's taste model. Score how much this person would want to attend each event (0-100).
Person: ${user.name ?? "unknown"}, ${user.role ?? ""} ${user.company ? "at " + user.company : ""}
Stated interests: ${user.interests ?? "none yet"}
Events they LIKED: ${liked.join("; ") || "none yet"}
Events they DISLIKED: ${disliked.join("; ") || "none yet"}

Events:
${events.map((e, i) => `${i}. ${e.name} — host: ${e.host}${e.description ? " — " + e.description.slice(0, 200).replace(/\s+/g, " ") : ""}`).join("\n")}

Rules: events similar to ones they DISLIKED (same vibe, topic, format or host) must score below 35. Events similar to ones they LIKED should score 80+. The reason should cite the liked/disliked event it resembles when relevant.
Do not use any tools. Reply ONLY with JSON: [{"i":0,"score":87,"reason":"<max 12 words, reference their likes when possible>"}, ...] covering every event.`;
  const { text: out } = await ask(await instanceFor(user), prompt);
  return parseJson<{ i: number; score: number; reason: string }[]>(out);
}

/** Pull fresh events, score them for this user, store, and act on them. */
export async function discoverFor(userId: string, opts: { limit?: number; notify?: boolean } = {}) {
  const user = await getUser(userId);
  const found = (await discoverLuma("sf", opts.limit ?? 30)).filter((e) => new Date(e.start_at) > new Date());
  await logActivity(user.id, "discover", `Scanned Luma SF discover → ${found.length} upcoming events`);

  const { data: rows, error } = await db().from("events").upsert(found, { onConflict: "source,source_id" }).select("id, name, host, description, start_at, url, source_id");
  if (error) throw error;

  // Only score events this user hasn't seen
  const { data: seen } = await db().from("user_events").select("event_id").eq("user_id", user.id);
  const seenIds = new Set((seen ?? []).map((s) => s.event_id));
  const fresh = (rows ?? []).filter((r) => !seenIds.has(r.id));
  if (!fresh.length) return { scored: 0 };

  const scores = await scoreEvents(user, fresh);
  const ue = scores.filter((s) => fresh[s.i]).map((s) => ({
    user_id: user.id, event_id: fresh[s.i].id, score: Math.round(s.score), reason: s.reason, status: "suggested",
  }));
  await db().from("user_events").upsert(ue, { onConflict: "user_id,event_id" });
  await logActivity(user.id, "scored", `Agent37 scored ${ue.length} new events for ${user.name ?? user.phone}`);

  if (opts.notify !== false) {
    const ranked = ue.map((u) => ({ ...u, ev: fresh.find((f) => f.id === u.event_id)! })).sort((a, b) => b.score - a.score);
    const ready = !!(user.email && (user as any).luma_connected);
    const auto = ready ? ranked.filter((r) => r.score >= user.auto_join_threshold).slice(0, 2) : [];
    const picks = ranked.filter((r) => !auto.includes(r)).slice(0, 3);
    // Header + one short, tapback-able text per pick
    const head = [`🐾 Scanned ${found.length} SF events — your top picks:`];
    if (auto.length) head.push("", ...auto.map((r) => `✅ Auto-joining ${r.ev.name} (${r.score}%)`));
    if (picks.length) head.push("", `❤️ or 👍 a pick to join · 👎 to pass (I learn from both). Or reply ${picks.map((_, i) => i + 1).join("/")}.`);
    if (!ready) head.push("(Connect Luma first so I can sign you up — text \"connect\")");
    await db().from("users").update({ pending_action: { type: "pick", event_ids: picks.map((p) => p.event_id) } }).eq("id", user.id);
    await text(user, head.join("\n").trim());
    const nums = ["1️⃣", "2️⃣", "3️⃣"];
    for (const [i, r] of picks.entries())
      await text(user, `${nums[i]} ${r.ev.name}\n${fmtTime(r.ev.start_at)} · ${r.score}% match\n${r.reason}`, r.event_id);
    for (const r of auto) void register(user.id, r.event_id, { quiet: true });
  }
  return { scored: ue.length };
}

export async function swipe(userId: string, eventId: string, dir: "like" | "dislike") {
  await db().from("user_events").upsert({ user_id: userId, event_id: eventId, swipe: dir }, { onConflict: "user_id,event_id" });
  const { data: ev } = await db().from("events").select("name").eq("id", eventId).single();
  await logActivity(userId, "swipe", `${dir === "like" ? "👍" : "👎"} ${ev?.name}`, eventId);
  if (dir === "like") return register(userId, eventId);
}

/** Have the user's agent computer register on the event page with their profile. */
export async function register(userId: string, eventId: string, opts: { quiet?: boolean } = {}) {
  const user = await getUser(userId);
  const { data: ev } = await db().from("events").select("*").eq("id", eventId).single();
  if (!ev) return;
  await db().from("user_events").upsert({ user_id: userId, event_id: eventId, status: "registering" }, { onConflict: "user_id,event_id" });
  await logActivity(userId, "registering", `Agent37 opening ${ev.url} to register`, eventId);

  let questions: { label: string; required: boolean }[] = [];
  try { questions = (await getLumaEvent(ev.source_id)).questions; } catch {}

  const prompt = `Register me for this event using your browser: ${ev.url}
You should already be logged in to Luma in your browser. Click the Register / Request to Join button and complete the form.
My profile:
- Name: ${user.name}
- Email: ${user.email}
- Company: ${user.company ?? ""}
- Role: ${user.role ?? ""}
- LinkedIn: ${user.linkedin ?? ""}
- About me: ${user.bio ?? ""}
${questions.length ? `The form asks: ${questions.map((q) => `"${q.label}"${q.required ? " (required)" : ""}`).join(", ")}. Answer each truthfully from my profile; for free-text "why" questions write 1-2 genuine sentences.` : ""}
Do NOT pay for anything. If the event is paid, sold out, or you hit a login wall or captcha, stop.
When done reply ONLY with JSON: {"status":"approved"|"pending"|"waitlisted"|"failed","note":"<short what happened>","answers":{"<question>":"<what you answered>"}}
Use "pending" if it says the host must approve, "approved" if you're confirmed/going.`;

  try {
    const { text: out } = await ask(await instanceFor(user), prompt);
    const r = parseJson<{ status: string; note: string; answers?: Record<string, string> }>(out);
    const status = ["approved", "pending", "waitlisted"].includes(r.status) ? r.status : "failed";
    await setStatus(user, ev, status, r.note, opts.quiet && status === "failed");
  } catch (e: any) {
    await setStatus(user, ev, "failed", String(e?.message ?? e).slice(0, 200), opts.quiet);
  }
}

export async function setStatus(user: User, ev: any, status: string, note?: string, silent = false) {
  const calendar_url = status === "approved" ? gcalLink(ev) : null;
  await db().from("user_events").update({ status, status_note: note ?? null, ...(calendar_url ? { calendar_url } : {}) })
    .eq("user_id", user.id).eq("event_id", ev.id);
  await logActivity(user.id, status, `${ev.name}: ${status}${note ? " — " + note : ""}`, ev.id);
  const msg: Record<string, string> = {
    approved: `🎉 You're IN for "${ev.name}" (${fmtTime(ev.start_at)}). Add to calendar: ${calendar_url}`,
    pending: `📝 Applied to "${ev.name}". Host has to approve — I'll ping you when you're in.`,
    waitlisted: `⏳ "${ev.name}" is full — you're on the waitlist.`,
    failed: `⚠️ Couldn't auto-register for "${ev.name}" — tap to finish: ${ev.url}`,
    cancelled: `👋 Cancelled your RSVP to "${ev.name}" — the host now knows you can't make it.`,
  };
  if (msg[status] && !silent) await text(user, msg[status]);
}

/** Ask the agent to check the event page for approval status changes. */
export async function checkApprovals(userId: string) {
  const user = await getUser(userId);
  const { data } = await db().from("user_events").select("event_id, events(*)").eq("user_id", userId).in("status", ["pending", "waitlisted"]);
  for (const row of data ?? []) {
    const ev: any = row.events;
    const { text: out } = await ask(await instanceFor(user),
      `Open ${ev.url} in your browser (logged in to Luma) and tell me my registration status. Reply ONLY JSON: {"status":"approved"|"pending"|"waitlisted"|"declined"}`);
    const { status } = parseJson<{ status: string }>(out);
    if (status && status !== "pending") await setStatus(user, ev, status);
  }
}

/** "Can you still make it?" for approved events starting within `hours`. */
export async function sendReminders(userId: string, hours = 24) {
  const user = await getUser(userId);
  const soon = new Date(Date.now() + hours * 3600_000).toISOString();
  const { data } = await db().from("user_events").select("event_id, events!inner(*)")
    .eq("user_id", userId).eq("status", "approved").is("reminder_sent_at", null).lte("events.start_at", soon);
  const row = data?.[0];
  if (!row) return false;
  const ev: any = row.events;
  await db().from("user_events").update({ reminder_sent_at: new Date().toISOString() }).eq("user_id", userId).eq("event_id", ev.id);
  await db().from("users").update({ pending_action: { type: "reminder", event_id: ev.id } }).eq("id", userId);
  await text(user, `⏰ "${ev.name}" is ${fmtTime(ev.start_at)}. Can you still make it? (yes / no)\nIf not, I'll cancel your RSVP so the host can give your spot to someone else.`);
  return true;
}

export async function cancel(userId: string, eventId: string) {
  const user = await getUser(userId);
  const { data: ev } = await db().from("events").select("*").eq("id", eventId).single();
  await logActivity(userId, "cancelling", `Agent37 cancelling RSVP for ${ev.name}`, eventId);
  try {
    await ask(await instanceFor(user), `Open ${ev.url} in your browser (logged in to Luma). I can no longer attend: cancel my registration / RSVP ("Can't go" / "Cancel registration"). Reply ONLY JSON {"ok":true|false,"note":"..."}`);
  } catch {}
  await setStatus(user, ev, "cancelled");
}

function gcalLink(ev: any) {
  const f = (d: string) => new Date(d).toISOString().replace(/[-:]|\.\d{3}/g, "");
  const end = ev.end_at ?? new Date(new Date(ev.start_at).getTime() + 2 * 3600_000).toISOString();
  const p = new URLSearchParams({ action: "TEMPLATE", text: ev.name, dates: `${f(ev.start_at)}/${f(end)}`, details: ev.url, location: ev.location ?? "" });
  return `https://calendar.google.com/calendar/render?${p}`;
}

/** Agent37 drives the Luma / Partiful passwordless login; the user texts back the code. */
async function startLogin(user: User, site: "luma" | "partiful", id: string) {
  const isEmail = id.includes("@");
  const prompt = site === "luma"
    ? `In your browser go to https://luma.com/signin . Sign in with ${isEmail ? `the email ${id}` : `the phone number ${id} (switch to "Use phone number" if needed)`} and continue. Luma will send a verification code. Stop there and leave the tab open. If you're already signed in as this account, say so. Reply ONLY JSON {"status":"code_sent"|"already_signed_in"|"error","note":""}`
    : `In your browser go to https://partiful.com/login . Enter the phone number ${id} and continue. Partiful will text a verification code. Stop there and leave the tab open. If already logged in, say so. Reply ONLY JSON {"status":"code_sent"|"already_signed_in"|"error","note":""}`;
  try {
    const r = parseJson<{ status: string; note: string }>((await ask(await instanceFor(user), prompt)).text);
    if (r.status === "already_signed_in") return finishLogin(user, site, null);
    if (r.status !== "code_sent") return text(user, `😵 ${site === "luma" ? "Luma" : "Partiful"} login hit a snag (${r.note}). Text "connect" to retry.`);
    await db().from("users").update({ pending_action: { type: "otp", site } }).eq("id", user.id);
    await text(user, site === "luma"
      ? `📩 Luma just sent a code to ${id}${isEmail ? " (check your inbox)" : ""}. Text it here.`
      : `📲 Partiful just texted a code to ${id}. Text it here.`);
  } catch {
    await text(user, `😵 Couldn't reach ${site} right now. Text "connect" to retry.`);
  }
}

async function finishLogin(user: User, site: "luma" | "partiful", code: string | null) {
  if (code) {
    const r = parseJson<{ ok: boolean; note?: string }>((await ask(await instanceFor(user),
      `In the ${site} login tab in your browser, enter the verification code ${code} and finish signing in (fill in name ${user.name ?? ""} if asked). Reply ONLY JSON {"ok":true|false,"note":""}`)).text);
    if (!r.ok) return text(user, `❌ That code didn't work${r.note ? ` (${r.note})` : ""}. Text the new code, or "connect" to restart.`);
  }
  await db().from("users").update({ [`${site}_connected`]: true, pending_action: null }).eq("id", user.id);
  await logActivity(user.id, "connected", `${site} connected via iMessage OTP`);
  if (site === "luma") {
    await db().from("users").update({ pending_action: { type: "partiful_id" } }).eq("id", user.id);
    await text(user, `✅ Luma connected!\n\nNow Partiful 🎉 What phone number do you use for Partiful? Text it, or "same" for this number, or "skip".`);
  } else {
    await text(user, `✅ Partiful connected! You're all set. Finding events for you now… 🔎`);
    void discoverFor(user.id);
  }
}

const WELCOME = (name?: string | null) => `🐾 Hey${name ? ` ${name.split(" ")[0]}` : ""}! I'm RSVPaw, your event concierge.

Here's what I do:
🔎 Find SF events you'll actually like (Luma + Partiful)
📝 Sign you up & answer the form questions for you
✅ Ping you the moment you're approved (+ calendar link)
⏰ Check you can still make it — and cancel for you if not, so hosts know

Save my contact card 👆 so you never miss an approval.

First, tell me about you in one text: email, company/role, LinkedIn, and what events you're into (and not into).`;

/** Inbound iMessage → { reply, welcome } (welcome = also send our contact card). */
export async function handleInbound(phone: string, body: string): Promise<{ reply: string | null; welcome?: boolean }> {
  const { user, isNew } = await getOrCreateUser(phone);
  await logActivity(user.id, "imessage_in", body);
  const t = body.trim().toLowerCase();
  const pa = user.pending_action ?? {};

  if (isNew || pa.type === "welcome" || /^(start|restart|help me get started)$/.test(t)) {
    await db().from("users").update({ pending_action: { type: "onboard" } }).eq("id", user.id);
    return { reply: WELCOME(user.name), welcome: true };
  }

  const yes = /^(y|yes|yeah|yep|sure|ok|okay|bet|down|👍|in)\b/.test(t);
  const no = /^(n|no|nah|nope|can'?t|cannot|pass|skip|👎)\b/.test(t);

  if (pa.type === "onboard") {
    const { text: out } = await ask(await instanceFor(user),
      `Extract a profile from this message. Do not use tools. Reply ONLY JSON {"name":"","email":"","company":"","role":"","linkedin":"","bio":"<1 sentence about them>","interests":"<likes and dislikes>"}. Use "" if unknown.\nMessage: ${body}`);
    const p = parseJson<Record<string, string>>(out);
    const patch = Object.fromEntries(Object.entries(p).filter(([k, v]) => v && !(k === "name" && user.name)));
    await db().from("users").update({ ...patch, pending_action: null }).eq("id", user.id);
    await db().from("users").update({ pending_action: { type: "luma_id" } }).eq("id", user.id);
    return { reply: `✅ Profile saved!\n\nNow let's connect Luma 🔗 (no password, I never see one). What do you sign in to Luma with — email or phone number? Just text it.` };
  }

  if (pa.type === "luma_id") {
    const id = body.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0] ?? normPhone(body);
    if (!id) return { reply: "Text the email or phone number you use for Luma 🙂" };
    if (id.includes("@") && !user.email) await db().from("users").update({ email: id }).eq("id", user.id);
    void startLogin(user, "luma", id);
    return { reply: `🔐 Starting Luma sign-in for ${id}…` };
  }

  if (pa.type === "partiful_id") {
    if (no) {
      await db().from("users").update({ pending_action: null }).eq("id", user.id);
      void discoverFor(user.id);
      return { reply: "👍 Skipped Partiful. Finding events for you now… 🔎" };
    }
    const id = /same|this/.test(t) ? user.phone : normPhone(body);
    if (!id) return { reply: `Text your Partiful phone number, "same", or "skip".` };
    void startLogin(user, "partiful", id);
    return { reply: `🔐 Starting Partiful sign-in for ${id}…` };
  }

  if (pa.type === "otp") {
    const code = body.match(/\d{4,8}/)?.[0];
    if (!code) return { reply: "Just text me the code digits 🙂" };
    void finishLogin(user, pa.site, code);
    return { reply: "🔐 Entering the code…" };
  }

  if (/^connect\b|^luma\b/.test(t)) {
    await db().from("users").update({ pending_action: { type: "luma_id" } }).eq("id", user.id);
    return { reply: "🔗 What do you sign in to Luma with — email or phone number?" };
  }
  if (/^partiful\b/.test(t)) {
    await db().from("users").update({ pending_action: { type: "partiful_id" } }).eq("id", user.id);
    return { reply: `🔗 What phone number do you use for Partiful? (or "same")` };
  }

  if (pa.type === "pick" && (/^[\d ,]+$/.test(t) || t === "all" || no)) {
    await db().from("users").update({ pending_action: null }).eq("id", user.id);
    const ids: string[] = pa.event_ids ?? [];
    if (no) { for (const id of ids) await swipe(user.id, id, "dislike"); return { reply: "👍 Skipped — I'll learn from that." }; }
    const chosen = t === "all" ? ids : [...new Set(t.match(/\d/g) ?? [])].map((n) => ids[+n - 1]).filter(Boolean);
    for (const id of ids) await swipe(user.id, id, chosen.includes(id) ? "like" : "dislike");
    return { reply: `🐾 On it — registering you for ${chosen.length} event${chosen.length === 1 ? "" : "s"}. I'll text when you're in.` };
  }

  if (pa.type === "reminder" && (yes || no)) {
    await db().from("users").update({ pending_action: null }).eq("id", user.id);
    if (yes) return { reply: "🙌 Great, see you there!" };
    void cancel(user.id, pa.event_id);
    return { reply: "No worries — cancelling your RSVP so the host can give your spot away." };
  }

  if (/find|events|discover|more|what'?s (on|happening)/.test(t)) {
    void discoverFor(user.id);
    return { reply: "🔎 Looking for events now…" };
  }
  if (/status|my events|upcoming|schedule/.test(t)) {
    const { data } = await db().from("user_events").select("status, events(name, start_at)").eq("user_id", user.id)
      .in("status", ["approved", "pending", "waitlisted", "registering"]);
    if (!data?.length) return { reply: "Nothing on the books yet — say \"find events\"." };
    return { reply: data.map((d: any) => `• ${d.events.name} — ${d.status} (${fmtTime(d.events.start_at)})`).join("\n") };
  }
  if (/^(hi|hey|hello|yo|sup)\b/.test(t)) return { reply: `Hey${user.name ? ` ${user.name.split(" ")[0]}` : ""} 🐾 Text "find events", "status", or "connect" (Luma).` };
  return { reply: `Try: "find events", "status", "connect" (Luma), or "partiful". 🐾` };
}

const LIKE = ["❤️", "♥️", "👍", "‼️", "😍", "🔥", "🙌", "love", "like"];
const DISLIKE = ["👎", "dislike"];

/** iMessage tapback on one of our event texts → like (register) / dislike (learn). */
export async function handleReaction(phone: string, emoji: string, targetMessageId: string, targetText?: string): Promise<string | null> {
  const dir = LIKE.includes(emoji) ? "like" : DISLIKE.includes(emoji) ? "dislike" : null;
  if (!dir) return null;
  let { data: sent } = await db().from("outbox").select("user_id, event_id, events(name)").eq("message_id", targetMessageId ?? "").maybeSingle();
  if (!sent && targetText) // fallback: match on the text we sent
    ({ data: sent } = await db().from("outbox").select("user_id, event_id, events(name)").eq("phone", phone).eq("body", targetText).not("event_id", "is", null).order("id", { ascending: false }).limit(1).maybeSingle());
  if (!sent?.event_id) return null;
  const { data: u } = await db().from("users").select("phone").eq("id", sent.user_id).single();
  if (u?.phone !== phone) return null;
  await logActivity(sent.user_id, "imessage_in", `${emoji} on "${(sent as any).events?.name}"`, sent.event_id);
  void swipe(sent.user_id, sent.event_id, dir);
  return dir === "like"
    ? `${emoji} Got it — signing you up for ${(sent as any).events?.name}. I'll find more like this.`
    : `👎 Noted — I'll skip events like ${(sent as any).events?.name}.`;
}

function normPhone(s: string) {
  const d = s.replace(/[^\d+]/g, "");
  if (/^\+\d{10,15}$/.test(d)) return d;
  if (/^\d{10}$/.test(d)) return "+1" + d;
  if (/^1\d{10}$/.test(d)) return "+" + d;
  return null;
}
