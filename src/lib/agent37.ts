// Agent37: each user gets a hosted agent computer (Hermes template).
const HOSTING = "https://api.agent37.com/v1";
const KEY = () => process.env.AGENT37_API_KEY!;

export async function createInstance(credit_micros = 2_000_000) {
  const res = await fetch(`${HOSTING}/instances`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ budget: { credit_micros } }),
  });
  if (!res.ok) throw new Error(`agent37 create ${res.status}: ${await res.text()}`);
  return res.json() as Promise<{ id: string; url: string; status: string }>;
}

/** Send a task to a user's agent computer. Returns the agent's final text. */
export async function ask(instanceId: string, input: string, sessionId?: string) {
  const res = await fetch(`https://${instanceId}.agent37.app/v1/responses`, {
    method: "POST",
    headers: { "X-Agent37-Key": KEY(), "Content-Type": "application/json" },
    body: JSON.stringify({ input, stream: false, ...(sessionId ? { session_id: sessionId } : {}) }),
  });
  if (!res.ok) throw new Error(`agent37 ask ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return { data, text: extractText(data), sessionId: data.session_id as string | undefined };
}

function extractText(d: any): string {
  if (typeof d?.output_text === "string") return d.output_text;
  if (Array.isArray(d?.output))
    return d.output.flatMap((o: any) => o.content ?? []).map((c: any) => c.text ?? "").join("");
  return typeof d === "string" ? d : JSON.stringify(d);
}

/** Pull the first JSON object/array out of an LLM reply. */
export function parseJson<T>(text: string): T {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/) ?? text.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
  return JSON.parse(m ? m[1] : text);
}
