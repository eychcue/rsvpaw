"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { browserDb } from "@/lib/supabase";

type Ev = { id: string; name: string; host: string; cover_url: string | null; location: string | null; start_at: string; url: string; requires_approval: boolean };
type UE = { id: string; event_id: string; score: number | null; reason: string | null; swipe: string | null; status: string; status_note: string | null; calendar_url: string | null; events: Ev };
type Act = { id: number; kind: string; message: string; created_at: string };
type U = { id: string; name: string | null; phone: string; interests: string | null };

const sb = browserDb();
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const STATUS: Record<string, string> = {
  registering: "bg-blue-500/15 text-blue-300", pending: "bg-amber-500/15 text-amber-300", approved: "bg-emerald-500/15 text-emerald-300",
  waitlisted: "bg-orange-500/15 text-orange-300", failed: "bg-red-500/15 text-red-300", cancelled: "bg-zinc-500/15 text-zinc-400",
  declined: "bg-red-500/15 text-red-300", closed: "bg-zinc-500/15 text-zinc-400", going: "bg-emerald-500/15 text-emerald-300",
};

async function act(body: object) {
  const r = await fetch("/api/action", { method: "POST", body: JSON.stringify(body) });
  return r.json();
}

export default function Dashboard() {
  const [users, setUsers] = useState<U[]>([]);
  const [uid, setUid] = useState<string>("");
  const [rows, setRows] = useState<UE[]>([]);
  const [feed, setFeed] = useState<Act[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    sb.from("users").select("id,name,phone,interests").order("created_at").then(({ data }) => {
      setUsers(data ?? []);
      if (data?.[0] && !uid) setUid(data[0].id);
    });
  }, [uid]);

  const load = useCallback(async () => {
    if (!uid) return;
    const [{ data: ue }, { data: a }] = await Promise.all([
      sb.from("user_events").select("*, events(*)").eq("user_id", uid),
      sb.from("activity").select("*").eq("user_id", uid).order("id", { ascending: false }).limit(40),
    ]);
    setRows((ue as UE[]) ?? []);
    setFeed(a ?? []);
  }, [uid]);

  useEffect(() => {
    load();
    const ch = sb.channel("live-" + uid)
      .on("postgres_changes", { event: "*", schema: "public", table: "user_events", filter: `user_id=eq.${uid}` }, load)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "activity", filter: `user_id=eq.${uid}` }, load)
      .subscribe();
    const poll = setInterval(load, 4000);
    return () => { sb.removeChannel(ch); clearInterval(poll); };
  }, [uid, load]);

  const deck = useMemo(() => rows.filter((r) => !r.swipe && r.status === "suggested" && new Date(r.events.start_at) > new Date())
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0)), [rows]);
  const mine = useMemo(() => rows.filter((r) => r.status !== "suggested")
    .sort((a, b) => +new Date(a.events.start_at) - +new Date(b.events.start_at)), [rows]);
  const top = deck[0];

  const run = async (label: string, body: object) => { setBusy(label); try { await act({ userId: uid, ...body }); } finally { setBusy(null); load(); } };
  const doSwipe = (dir: "like" | "dislike") => top && act({ action: "swipe", userId: uid, eventId: top.event_id, dir }).then(load);

  return (
    <main className="min-h-screen bg-[#0b0b10] text-zinc-100">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-6 py-4">
        <div className="flex items-center gap-3">
          <a href="/"><img src="/logo.png" alt="RSVPaw" className="h-10 w-10 rounded-xl" /></a>
          <div>
            <h1 className="text-xl font-bold tracking-tight">RSVPaw</h1>
            <p className="text-xs text-zinc-400">Your event-registration agent · Agent37 + Supabase + iMessage</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={uid} onChange={(e) => setUid(e.target.value)} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm">
            {users.map((u) => <option key={u.id} value={u.id} className="bg-zinc-900">{u.name ?? u.phone}</option>)}
          </select>
          <Btn onClick={() => run("discover", { action: "discover" })} busy={busy === "discover"}>🔎 Find events</Btn>
          <Btn onClick={() => run("check", { action: "check" })} busy={busy === "check"}>✅ Check approvals</Btn>
          <Btn onClick={() => run("remind", { action: "remind" })} busy={busy === "remind"}>⏰ Send reminder</Btn>
        </div>
      </header>

      <div className="grid gap-6 p-6 lg:grid-cols-[1.1fr_1fr_0.9fr]">
        {/* Swipe deck */}
        <section>
          <H>For you <span className="text-zinc-500">({deck.length})</span></H>
          {top ? (
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
              {top.events.cover_url && <img src={top.events.cover_url} alt="" className="aspect-[2/1] w-full object-cover" />}
              <div className="space-y-2 p-5">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-lg font-semibold leading-snug">{top.events.name}</h3>
                  <span className="shrink-0 rounded-full bg-fuchsia-500/20 px-2.5 py-1 text-sm font-bold text-fuchsia-300">{top.score}%</span>
                </div>
                <p className="text-sm text-zinc-400">{top.events.host} · {when(top.events.start_at)}{top.events.location ? ` · ${top.events.location}` : ""}</p>
                <p className="text-sm text-fuchsia-200/90">✨ {top.reason}</p>
                {top.events.requires_approval && <p className="text-xs text-amber-300/80">Requires host approval</p>}
                <div className="flex gap-3 pt-3">
                  <button onClick={() => doSwipe("dislike")} className="flex-1 rounded-xl bg-white/5 py-3 text-xl hover:bg-white/10">👎</button>
                  <button onClick={() => doSwipe("like")} className="flex-1 rounded-xl bg-fuchsia-600 py-3 text-xl hover:bg-fuchsia-500">👍 Sign me up</button>
                </div>
              </div>
            </div>
          ) : <Empty>No suggestions yet — hit “Find events”.</Empty>}
          {deck.slice(1, 6).map((r) => (
            <div key={r.id} className="mt-2 flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.02] px-4 py-2 text-sm">
              <span className="truncate">{r.events.name}</span><span className="ml-3 text-zinc-500">{r.score}%</span>
            </div>
          ))}
        </section>

        {/* Registrations */}
        <section>
          <H>My events</H>
          {mine.length ? mine.map((r) => (
            <div key={r.id} className="mb-2 rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-start justify-between gap-3">
                <a href={r.events.url} target="_blank" className="font-medium hover:underline">{r.events.name}</a>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS[r.status] ?? ""}`}>
                  {r.status === "registering" ? "⏳ registering…" : r.status}
                </span>
              </div>
              <p className="mt-1 text-xs text-zinc-400">{when(r.events.start_at)}</p>
              {r.status_note && <p className="mt-1 text-xs text-zinc-500">{r.status_note}</p>}
              <div className="mt-2 flex gap-3 text-xs">
                {r.calendar_url && <a href={r.calendar_url} target="_blank" className="text-emerald-300 hover:underline">📅 Add to calendar</a>}
                {["approved", "pending", "waitlisted"].includes(r.status) && (
                  <button onClick={() => run("cancel", { action: "cancel", eventId: r.event_id })} className="text-zinc-400 hover:text-red-300">Can’t make it → cancel</button>
                )}
              </div>
            </div>
          )) : <Empty>Nothing yet. 👍 an event and your agent registers you.</Empty>}
        </section>

        {/* Live agent feed */}
        <section>
          <H>Agent activity <span className="ml-1 inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400" /></H>
          <ol className="space-y-2">
            {feed.map((a) => (
              <li key={a.id} className={`rounded-lg px-3 py-2 text-xs ${a.kind.startsWith("imessage") ? "bg-sky-500/10 text-sky-200" : "bg-white/[0.03] text-zinc-300"}`}>
                <span className="mr-2 text-zinc-500">{new Date(a.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                {a.kind === "imessage_out" ? "💬 → " : a.kind === "imessage_in" ? "💬 ← " : ""}
                <span className="whitespace-pre-line">{a.message}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  );
}

const H = ({ children }: { children: React.ReactNode }) => <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">{children}</h2>;
const Empty = ({ children }: { children: React.ReactNode }) => <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-zinc-500">{children}</div>;
const Btn = ({ children, onClick, busy }: { children: React.ReactNode; onClick: () => void; busy?: boolean }) => (
  <button onClick={onClick} disabled={busy} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50">{busy ? "…" : children}</button>
);
