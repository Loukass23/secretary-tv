// Secretary Desk's phone keyboard for the TV's search. The search screen shows a QR code for /type/<code>, a code the
// TV picks for that one open search; the page sends what is typed on the phone to /type/<code>/text, and the TV reads it
// back from there about once a second while the search is open. Typings live in memory only and expire.

/** The TV's code: random, long enough not to guess, safe in a path. */
export const TYPE_CODE = /^[a-z0-9]{12,40}$/;
/** Longest text kept, about two lines of a title. */
export const TYPE_MAX = 120;
const TTL_MS = 30 * 60_000;
const MAX_CODES = 32;

export interface Typing {
  text: string;
  /** Bumped by every write, so the TV can tell a new text from the one it has. */
  rev: number;
}

export function createTypingStore(now: () => number = Date.now) {
  const m = new Map<string, Typing & { at: number }>();
  const prune = () => {
    const t = now();
    for (const [k, v] of m) if (t - v.at > TTL_MS) m.delete(k);
  };
  return {
    get(code: string): Typing {
      prune();
      const hit = m.get(code);
      return hit ? { text: hit.text, rev: hit.rev } : { text: "", rev: 0 };
    },
    put(code: string, text: string): Typing {
      prune();
      const clean = text.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, TYPE_MAX);
      const prev = m.get(code);
      m.delete(code);
      // The oldest code goes first when there are too many.
      if (m.size >= MAX_CODES) m.delete(m.keys().next().value as string);
      const next = { text: clean, rev: (prev?.rev ?? 0) + 1, at: now() };
      m.set(code, next);
      return { text: next.text, rev: next.rev };
    },
  };
}

/** The phone's page: one text field; every change is sent, at most every 250 ms, and the last one always. */
export function renderTypeHtml(baseUrl: string, code: string): string {
  const api = JSON.stringify(`${baseUrl}/type/${code}/text`).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
  <title>Secretary Desk · Type on the TV</title>
  <style>
    :root { --bg: #0a0a0e; --card: #181920; --border: #262833; --text: #f4f1ea; --dim: #9ca0ab; --accent: #ff5a26; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 24px 16px; background: var(--bg); color: var(--text); font: 16px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 560px; margin-inline: auto; }
    h1 { margin: 0 0 4px; font-size: 22px; }
    .sub { color: var(--dim); font-size: 14px; margin-bottom: 20px; }
    input { width: 100%; padding: 14px 16px; border-radius: 12px; border: 1px solid var(--border); background: var(--card); color: var(--text); font-size: 20px; }
    input:focus { outline: 2px solid var(--accent); }
    .state { margin-top: 12px; color: var(--dim); font-size: 14px; min-height: 20px; }
  </style>
</head>
<body>
  <h1>Secretary Desk</h1>
  <div class="sub">What you type here goes into the search on the TV.</div>
  <input id="q" type="search" placeholder="Search films, shows and anime" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="${TYPE_MAX}" autofocus />
  <div id="state" class="state"></div>
  <script>
    const API = ${api};
    const q = document.getElementById('q');
    const state = document.getElementById('state');
    let last = 0, timer = null, sent = null;
    async function send() {
      timer = null;
      last = Date.now();
      const text = q.value;
      if (text === sent) return;
      sent = text;
      try {
        const res = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
        state.textContent = res.ok ? 'On the TV' : 'Not sent: try again';
      } catch { state.textContent = 'Cannot reach Secretary'; }
    }
    q.addEventListener('input', () => {
      state.textContent = '';
      if (!timer) timer = setTimeout(send, Math.max(0, last + 250 - Date.now()));
    });
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { q.blur(); } });
    fetch(API).then((r) => r.json()).then((t) => { if (!q.value && t.text) { q.value = t.text; sent = t.text; } }).catch(() => {});
  </script>
</body>
</html>`;
}
