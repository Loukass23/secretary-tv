// The phone keyboard without Secretary Desk: a paste box per code, one Durable Object each. The TV shows a QR for
// /type/<code>, the phone pastes there (AniList's sign-in token, docs/anilist.md), and the TV reads /type/<code>/text
// about once a second, the same paths and answers as Desk's keyboard (server/src/phone-keys.ts), so the TV's
// watchPhone reads either. A box forgets its text 15 minutes after the last write.
import type { DurableObjectStateLike } from "./cf.ts";

/** The TV's code: random, long enough not to guess, safe in a path (the TV's typeCode makes 16). */
export const PASTE_CODE = /^[a-z0-9]{12,40}$/;
/** Longest text kept: room for a sign-in token (AniList's are about 1,000 characters). */
export const PASTE_MAX = 4096;
export const PASTE_TTL_MS = 15 * 60_000;

export interface Pasted {
  text: string;
  /** Bumped by every write, so the TV can tell a new text from the one it has. */
  rev: number;
}

/** Control characters out, then cut to the limit. Pure. */
export const cleanPaste = (text: string) => text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").slice(0, PASTE_MAX);

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export class PasteBox {
  private readonly state: DurableObjectStateLike;
  private readonly now: () => number;

  constructor(state: DurableObjectStateLike, _env?: unknown, now: () => number = Date.now) {
    this.state = state;
    this.now = now;
  }

  async fetch(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (path === "/get") return json(200, (await this.state.storage.get<Pasted>("box")) ?? { text: "", rev: 0 });
    if (path === "/put" && req.method === "POST") {
      const body = (await req.json().catch(() => null)) as { text?: unknown } | null;
      if (typeof body?.text !== "string") return json(400, { error: "expected {text}" });
      const prev = await this.state.storage.get<Pasted>("box");
      const next: Pasted = { text: cleanPaste(body.text), rev: (prev?.rev ?? 0) + 1 };
      await this.state.storage.put("box", next);
      await this.state.storage.setAlarm(this.now() + PASTE_TTL_MS);
      return json(200, next);
    }
    return json(404, { error: "not found" });
  }

  async alarm(): Promise<void> {
    await this.state.storage.deleteAll();
  }
}

/** The phone's page: one box to paste into and a button that sends it. `what` names what is pasted. */
export function pastePage(code: string, what: string): string {
  const safe = what.replace(/[^\w .-]/g, "").slice(0, 40) || "text";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Secretary · Paste on the TV</title>
<style>
  :root { --bg: #0a0a0e; --card: #181920; --line: #262833; --ink: #f4f1ea; --dim: #9ca0ab; --accent: #d9622b; }
  * { box-sizing: border-box; }
  body { margin: 0 auto; padding: 24px 16px; max-width: 560px; background: var(--bg); color: var(--ink); font: 16px/1.45 system-ui, sans-serif; }
  h1 { margin: 0 0 4px; font-size: 22px; }
  p { margin: 0 0 16px; color: var(--dim); font-size: 14px; }
  textarea { width: 100%; min-height: 160px; padding: 12px; border-radius: 12px; border: 1px solid var(--line); background: var(--card); color: var(--ink); font: 14px/1.4 ui-monospace, monospace; word-break: break-all; }
  button { margin-top: 12px; width: 100%; padding: 14px; border: 0; border-radius: 12px; background: var(--accent); color: #fff; font-size: 18px; font-weight: 600; }
  #state { margin-top: 12px; min-height: 20px; color: var(--dim); font-size: 14px; }
</style>
</head>
<body>
<h1>Paste on the TV</h1>
<p>Paste your ${safe} below and send it. The TV picks it up within a second or two.</p>
<textarea id="t" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="${PASTE_MAX}" placeholder="Paste here"></textarea>
<button id="go">Send to the TV</button>
<div id="state"></div>
<script>
  const API = location.pathname.replace(/\\/$/, "") + "/text";
  const t = document.getElementById("t"), state = document.getElementById("state");
  document.getElementById("go").addEventListener("click", async () => {
    state.textContent = "Sending…";
    try {
      const res = await fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: t.value }) });
      state.textContent = res.ok ? "Sent: look at the TV." : "Not sent: try again.";
    } catch { state.textContent = "Cannot reach Secretary: try again."; }
  });
</script>
</body>
</html>`;
}
