// Luma public endpoints (no auth) used by luma.com itself.
const API = "https://api.lu.ma";

type Doc = { type: string; text?: string; content?: Doc[] };
const docToText = (d?: Doc): string =>
  !d ? "" : d.text ?? (d.content ?? []).map(docToText).join(d.type === "paragraph" ? "" : " ") + (d.type === "paragraph" ? "\n" : "");

export type LumaEvent = {
  source: "luma";
  source_id: string;
  url: string;
  name: string;
  description: string;
  host: string;
  cover_url: string | null;
  location: string | null;
  start_at: string;
  end_at: string | null;
  requires_approval: boolean;
  discovered_via: string;
};

/** Upcoming events in a city from Luma's discover feed (default: SF). */
export async function discoverLuma(slug = "sf", limit = 40) {
  const res = await fetch(`${API}/discover/get-paginated-events?pagination_limit=${limit}&slug=${slug}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`luma discover ${res.status}`);
  const { entries } = await res.json();
  return (entries as any[])
    // skip events you can't actually get into
    .filter((e) => !e.ticket_info?.is_sold_out && !["closed", "not-open", "sold-out"].includes(e.registration_availability))
    .map((e) => ({
    source: "luma" as const,
    source_id: e.event.api_id,
    url: `https://luma.com/${e.event.url}`,
    name: e.event.name,
    description: "",
    host: e.calendar?.name || e.hosts?.map((h: any) => h.name).join(", ") || "",
    cover_url: e.event.cover_url ?? null,
    location: e.event.geo_address_info?.short_address ?? e.event.geo_address_info?.city_state ?? null,
    start_at: e.event.start_at,
    end_at: e.event.end_at ?? null,
    requires_approval: !!e.ticket_info?.require_approval,
    discovered_via: "luma-discover",
  })) satisfies LumaEvent[];
}

/** Full details incl. description + registration questions. */
export async function getLumaEvent(apiId: string) {
  const res = await fetch(`${API}/event/get?event_api_id=${apiId}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`luma event ${res.status}`);
  const d = await res.json();
  return {
    description: docToText(d.description_mirror).trim().slice(0, 4000),
    requires_approval: !!d.ticket_info?.require_approval,
    questions: (d.registration_questions ?? []).map((q: any) => ({ label: q.label, required: q.required, type: q.question_type })),
  };
}

// ── Passwordless Luma login via the same endpoints luma.com uses (no browser, no captcha page) ──
export async function lumaStartEmail(email: string) {
  const res = await fetch(`${API}/auth/email/start-with-email`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.message ?? `luma start ${res.status}`);
  return body;
}

/** Exchange the emailed code for a Luma session key. */
export async function lumaVerifyEmail(email: string, code: string) {
  const res = await fetch(`${API}/auth/email/sign-in-with-code`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, code }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.message ?? `luma verify ${res.status}`);
  const cookie = res.headers.get("set-cookie") ?? "";
  const session = body?.auth_token ?? cookie.match(/luma\.auth-session-key=([^;]+)/)?.[1] ?? null;
  return { session, user: body?.user ?? null };
}
