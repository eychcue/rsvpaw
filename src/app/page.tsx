"use client";
import { useState } from "react";

const LINE = "+14152250168";
const LINE_PRETTY = "+1 (415) 225-0168";

function toE164(raw: string) {
  const d = raw.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return d.length > 6 ? `+${d}` : null;
}

export default function Home() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = toE164(phone);
    if (!name.trim()) return setErr("What should RSVPaw call you?");
    if (!p) return setErr("That phone number doesn't look right.");
    setErr(null);
    setBusy(true);
    try {
      const r = await fetch("/api/action", {
        method: "POST",
        body: JSON.stringify({ action: "signup", phone: p, profile: { name: name.trim(), pending_action: { type: "welcome" } } }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Signup failed");
      setDone(`Hi RSVPaw! I'm ${name.trim().split(" ")[0]} 🐾`);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const smsLink = done ? `sms:${LINE}&body=${encodeURIComponent(done)}` : "";

  return (
    <main className="min-h-screen bg-[#0b0b10] text-zinc-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,rgba(192,38,211,0.18),transparent_60%)]" />
      <div className="relative mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-16">
        <header className="flex items-center gap-3">
          <img src="/logo.png" alt="RSVPaw" className="h-12 w-12 rounded-2xl" />
          <span className="text-2xl font-bold tracking-tight">RSVPaw</span>
        </header>

        <div className="mt-10 grid items-start gap-10 md:grid-cols-[1.1fr_1fr]">
          <section>
            <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
              Your event concierge,<br />
              <span className="text-fuchsia-400">over iMessage.</span>
            </h1>
            <p className="mt-4 max-w-md text-lg text-zinc-400">
              Finds SF events you&apos;ll love, signs you up, tracks approvals, and checks you can still make it.
            </p>

            <ol className="mt-10 grid gap-3 sm:grid-cols-3">
              {[
                ["💬", "Text RSVPaw", "Say hi. It learns who you are in one message."],
                ["🔐", "Connect Luma & Partiful", "Text back the login code. No passwords, ever."],
                ["👍", "Swipe your picks", "It registers you, pings approvals & reminds you."],
              ].map(([icon, title, body], i) => (
                <li key={title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="text-2xl">{icon}</div>
                  <div className="mt-2 text-xs font-semibold uppercase tracking-wider text-fuchsia-300">Step {i + 1}</div>
                  <div className="mt-1 font-semibold">{title}</div>
                  <p className="mt-1 text-sm text-zinc-400">{body}</p>
                </li>
              ))}
            </ol>
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl shadow-fuchsia-900/20">
            {!done ? (
              <form onSubmit={submit} className="space-y-4">
                <h2 className="text-xl font-semibold">Get started</h2>
                <label className="block">
                  <span className="text-sm text-zinc-400">Name</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Lovelace" autoComplete="name"
                    className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 outline-none focus:border-fuchsia-500" />
                </label>
                <label className="block">
                  <span className="text-sm text-zinc-400">iPhone number</span>
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(415) 555-0123" type="tel" autoComplete="tel"
                    className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 outline-none focus:border-fuchsia-500" />
                </label>
                {err && <p className="text-sm text-red-300">{err}</p>}
                <button disabled={busy} className="w-full rounded-xl bg-fuchsia-600 py-3 font-semibold hover:bg-fuchsia-500 disabled:opacity-50">
                  {busy ? "Setting you up…" : "Continue →"}
                </button>
              </form>
            ) : (
              <div className="space-y-5">
                <h2 className="text-xl font-semibold">Last step: say hi 👋</h2>
                {/* iPhone Messages preview */}
                <div className="overflow-hidden rounded-2xl border border-white/10 bg-black">
                  <div className="flex flex-col items-center gap-1 border-b border-white/10 bg-zinc-900/80 py-3">
                    <img src="/logo.png" alt="" className="h-10 w-10 rounded-full" />
                    <span className="text-xs text-zinc-300">RSVPaw</span>
                    <span className="text-[10px] text-zinc-500">{LINE_PRETTY}</span>
                  </div>
                  <div className="flex min-h-28 flex-col justify-end gap-1 p-4">
                    <div className="ml-auto max-w-[80%] rounded-2xl rounded-br-md bg-[#0a84ff] px-3.5 py-2 text-sm text-white">{done}</div>
                    <span className="ml-auto text-[10px] text-zinc-500">iMessage</span>
                  </div>
                </div>
                <a href={smsLink} className="block w-full rounded-xl bg-[#0a84ff] py-3 text-center font-semibold text-white hover:brightness-110">
                  Open iMessage
                </a>
                <div className="hidden items-center gap-4 sm:flex">
                  <img src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(smsLink)}`}
                    alt="Scan to text RSVPaw" className="h-28 w-28 rounded-lg bg-white p-1.5" />
                  <p className="text-sm text-zinc-400">On a laptop? Scan with your iPhone camera to open the message.</p>
                </div>
                <p className="text-sm text-zinc-400">
                  RSVPaw will reply with your contact card — save it so you never miss an approval.
                </p>
              </div>
            )}
          </section>
        </div>

        <footer className="mt-16 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-6 text-sm text-zinc-500">
          <span>Powered by Agent37 · Supabase · Photon iMessage</span>
          <a href="/dashboard" className="hover:text-zinc-300">Live agent dashboard →</a>
        </footer>
      </div>
    </main>
  );
}
