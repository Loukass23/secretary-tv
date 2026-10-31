import { parseWatchIntent, type WatchIntent } from "./intent.ts";
import type { SearchResult } from "./search.ts";
import type { createStateStore, DomoticDevice, StoredReminder } from "./state.ts";

type StateStore = ReturnType<typeof createStateStore>;

export interface AiCommandResult {
  reply: string;
  action: "reminder_added" | "domotics_updated" | "briefing" | "watch";
  reminders: StoredReminder[];
  domotics: DomoticDevice[];
  /** For "watch": what was searched or browsed, and the titles Nest shows next to the assistant. */
  query?: string;
  results?: SearchResult[];
}

const KIND_LABEL = { movie: "films", series: "series", anime: "anime" } as const;

/** What a watch prompt searched or browsed, in words for the TV ("comedy films", "“dune”"). */
export function describeIntent(intent: WatchIntent): string {
  if (intent.term) return `“${intent.term}”`;
  const kind = intent.kind ? KIND_LABEL[intent.kind] : "films and series";
  return intent.genre ? `${intent.genre.toLowerCase()} ${kind}` : `top ${kind}`;
}

export interface SmartThingsPhonePresence {
  id: string;
  name: string;
  present: boolean;
}

interface RawStDevice {
  deviceId?: string;
  name?: string;
  label?: string;
  type?: string;
  deviceTypeName?: string;
  components?: {
    id?: string;
    capabilities?: { id?: string }[];
  }[];
}

/**
 * Discovers real SmartThings lighting/switch devices and mobile presence sensors (e.g. Galaxy S10)
 * from `GET https://api.smartthings.com/v1/devices` (read-only).
 */
export async function syncSmartThingsDevices(
  token: string | undefined,
  state: StateStore,
  f: typeof fetch = fetch,
): Promise<{ devices: DomoticDevice[]; phone?: SmartThingsPhonePresence }> {
  if (!token) return { devices: state.getDomotics() };
  try {
    const res = await f("https://api.smartthings.com/v1/devices", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { devices: state.getDomotics() };
    const body = (await res.json()) as { items?: RawStDevice[] };
    const items = body.items ?? [];

    let phone: SmartThingsPhonePresence | undefined;
    const mobileDev = items.find(
      (d) =>
        d.type === "MOBILE" ||
        d.components?.some((c) => c.capabilities?.some((cap) => cap.id === "presenceSensor")),
    );
    if (mobileDev?.deviceId) {
      let present = true;
      try {
        const sRes = await f(
          `https://api.smartthings.com/v1/devices/${encodeURIComponent(mobileDev.deviceId)}/status`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (sRes.ok) {
          const sData = (await sRes.json()) as {
            components?: { main?: { presenceSensor?: { presence?: { value?: string } } } };
          };
          present = sData.components?.main?.presenceSensor?.presence?.value === "present";
        }
      } catch {
        // Default to present if status read fails.
      }
      phone = {
        id: mobileDev.deviceId,
        name: mobileDev.label || mobileDev.name || "SmartThings Phone",
        present,
      };
    }

    // Filter to lighting / switch devices (excluding TVs, vacuums, and sensors), prioritizing dimmable & named lights first.
    const lightCandidates = items
      .filter((d) => {
        if (!d.deviceId || d.type === "OCF" || d.type === "HUB" || d.type === "MOBILE") return false;
        const caps = d.components?.flatMap((c) => c.capabilities?.map((x) => x.id) ?? []) ?? [];
        return caps.includes("switch");
      })
      .sort((a, b) => {
        const aCaps = a.components?.flatMap((c) => c.capabilities?.map((x) => x.id) ?? []) ?? [];
        const bCaps = b.components?.flatMap((c) => c.capabilities?.map((x) => x.id) ?? []) ?? [];
        const aScore = (aCaps.includes("switchLevel") ? 2 : 0) + (/light|lamp|neon/i.test(a.label || a.name || "") ? 1 : 0);
        const bScore = (bCaps.includes("switchLevel") ? 2 : 0) + (/light|lamp|neon/i.test(b.label || b.name || "") ? 1 : 0);
        return bScore - aScore;
      });

    if (lightCandidates.length > 0) {
      const existingById = new Map(state.getDomotics().map((d) => [d.id, d]));
      const topCandidates = lightCandidates.slice(0, 6);
      const statuses = await Promise.all(
        topCandidates.map(async (d) => {
          const id = d.deviceId!;
          try {
            const sRes = await f(`https://api.smartthings.com/v1/devices/${encodeURIComponent(id)}/status`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (!sRes.ok) return null;
            const sData = (await sRes.json()) as {
              components?: {
                main?: {
                  switch?: { switch?: { value?: string } };
                  switchLevel?: { level?: { value?: number } };
                };
              };
            };
            const sw = sData.components?.main?.switch?.switch?.value;
            const lvl = sData.components?.main?.switchLevel?.level?.value;
            return {
              on: sw === "on" ? true : sw === "off" ? false : undefined,
              level: typeof lvl === "number" ? lvl : undefined,
            };
          } catch {
            return null;
          }
        }),
      );
      const mapped: DomoticDevice[] = topCandidates.map((d, idx) => {
        const id = d.deviceId!;
        const prev = existingById.get(id);
        const st = statuses[idx];
        const label = d.label || d.name || id;
        const caps = d.components?.flatMap((c) => c.capabilities?.map((x) => x.id) ?? []) ?? [];
        const hasLevel = caps.includes("switchLevel");
        return {
          id,
          name: label,
          room: hasLevel ? "Dimmable" : "Switch",
          on: st?.on ?? prev?.on ?? false,
          level: st?.level ?? prev?.level ?? (hasLevel ? 60 : 100),
          provider: "smartthings",
        };
      });
      state.setDomotics(mapped);
    }

    return { devices: state.getDomotics(), phone };
  } catch {
    return { devices: state.getDomotics() };
  }
}

export async function forwardSmartThingsCommand(
  token: string | undefined,
  deviceId: string,
  patch: { on?: boolean; level?: number },
  f: typeof fetch = fetch,
  dryRun = false,
): Promise<boolean> {
  if (!token || dryRun) return false;
  const commands: { component: string; capability: string; command: string; arguments: unknown[] }[] = [];
  if (typeof patch.on === "boolean") {
    commands.push({
      component: "main",
      capability: "switch",
      command: patch.on ? "on" : "off",
      arguments: [],
    });
  }
  if (typeof patch.level === "number" && patch.on !== false) {
    commands.push({
      component: "main",
      capability: "switchLevel",
      command: "setLevel",
      arguments: [Math.max(0, Math.min(100, Math.round(patch.level)))],
    });
  }
  if (!commands.length) return false;
  try {
    const res = await f(`https://api.smartthings.com/v1/devices/${encodeURIComponent(deviceId)}/commands`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ commands }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function forwardSmartThingsScene(
  token: string | undefined,
  prevDevices: readonly DomoticDevice[],
  nextDevices: readonly DomoticDevice[],
  f: typeof fetch = fetch,
  dryRun = false,
  targetIds?: readonly string[],
): Promise<void> {
  if (!token || dryRun) return;
  const prevById = new Map(prevDevices.map((d) => [d.id, d]));
  const idSet = targetIds && targetIds.length > 0 ? new Set(targetIds) : null;
  await Promise.all(
    nextDevices.map(async (d) => {
      if (idSet && !idSet.has(d.id)) return;
      const prev = prevById.get(d.id);
      if (prev && prev.on === d.on && (!d.on || prev.level === d.level)) return;
      const patch: { on?: boolean; level?: number } = { on: d.on };
      if (d.on && (d.room === "Dimmable" || d.room === "Living Room")) {
        patch.level = d.level;
      }
      await forwardSmartThingsCommand(token, d.id, patch, f, dryRun);
    }),
  );
}

const GEMINI_FALLBACK_MODELS = [
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-flash-lite-latest",
  "gemini-3.8-flash",
] as const;

export async function handleAiPrompt(
  prompt: string,
  state: StateStore,
  opts: {
    geminiApiKey?: string;
    smartThingsToken?: string;
    dryRun?: boolean;
    fetch?: typeof fetch;
    /** Finds titles for a watch prompt (search or browse); without it such prompts fall through to the briefing. */
    find?: (intent: WatchIntent) => Promise<SearchResult[]>;
  } = {},
): Promise<AiCommandResult> {
  const clean = prompt.trim();
  const lower = clean.toLowerCase();

  // 1. Check for reminder intent: "remind me to <task> [at <time>]" or "add reminder <task>"
  const remMatch =
    clean.match(/^(?:remind\s+me\s+to|add\s+(?:a\s+)?reminder\s+to|remind\s+me|reminder:?)\s+(.+)$/i);
  if (remMatch) {
    let taskText = remMatch[1].trim();
    let due: string | undefined;
    const timeMatch = taskText.match(/\s+(?:at|by|on)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?|tomorrow|tonight|today)$/i);
    if (timeMatch) {
      due = timeMatch[1];
      taskText = taskText.slice(0, timeMatch.index).trim();
    }
    const reminders = state.addReminder({ text: taskText, due, source: "gemini" });
    const reply = `Added to your Secretary Nest reminders: “${taskText}”${due ? ` (${due})` : ""}.`;
    state.setAiSummary(reply);
    return {
      reply,
      action: "reminder_added",
      reminders,
      domotics: state.getDomotics(),
    };
  }

  // 2. Something to watch: "show me a comedy", "play dune", "something for tonight".
  const watch = opts.find ? parseWatchIntent(clean) : null;
  if (watch && opts.find) {
    const query = describeIntent(watch);
    let results: SearchResult[] = [];
    try {
      results = await opts.find(watch);
    } catch {
      // The catalogs are down; say so below.
    }
    const reply = results.length
      ? watch.term
        ? `Here is what I found for ${query}.`
        : `Here are ${query} worth a look.`
      : `I couldn't find anything for ${query}.`;
    return {
      reply,
      action: "watch",
      reminders: state.getReminders(),
      domotics: state.getDomotics(),
      query,
      results,
    };
  }

  // 3. Check for lighting / domotics intent: "cinema mode", "dim lights to 20%", "turn off lights", "turn on lights"
  if (/(?:light|lamp|cinema|dim|bright)/i.test(lower)) {
    const prevDomotics = structuredClone(state.getDomotics());
    let domotics = prevDomotics;
    let reply = "";
    const pctMatch = lower.match(/(\d{1,3})\s*%/);
    if (lower.includes("cinema") || lower.includes("movie mode")) {
      domotics = state.applyDomoticScene("cinema");
      await forwardSmartThingsScene(
        opts.smartThingsToken,
        prevDomotics,
        domotics,
        opts.fetch,
        opts.dryRun,
      );
      reply = "🦅 Cinema stomp executed: Dimmable lights crushed to 15%, glare eliminated.";
    } else if (lower.includes("off")) {
      domotics = state.applyDomoticScene("off");
      await forwardSmartThingsScene(
        opts.smartThingsToken,
        prevDomotics,
        domotics,
        opts.fetch,
        opts.dryRun,
      );
      reply = "🦅 All territory lights extinguished.";
    } else if (pctMatch) {
      const level = Math.max(0, Math.min(100, Number(pctMatch[1])));
      for (const d of domotics) {
        state.updateDomoticDevice(d.id, { on: level > 0, level });
        await forwardSmartThingsCommand(
          opts.smartThingsToken,
          d.id,
          { on: level > 0, level },
          opts.fetch,
          opts.dryRun,
        );
      }
      domotics = state.getDomotics();
      reply = `Adjusted lights to ${level}%.`;
    } else {
      domotics = state.applyDomoticScene("warm");
      await forwardSmartThingsScene(
        opts.smartThingsToken,
        prevDomotics,
        domotics,
        opts.fetch,
        opts.dryRun,
      );
      reply = "Set SmartThings lights to Warm 70%.";
    }
    state.setAiSummary(reply);
    return {
      reply,
      action: "domotics_updated",
      reminders: state.getReminders(),
      domotics,
    };
  }

  // 4. Optional Gemini REST API call for general assistant queries / briefings when GEMINI_API_KEY is present.
  if (opts.geminiApiKey) {
    const f = opts.fetch ?? fetch;
    const activeReminders = state
      .getReminders()
      .filter((r) => !r.completed)
      .map((r) => r.text)
      .join("; ");
    const payload = JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: `You are the Secretary Bird (Sagittarius serpentarius), an aristocratic, razor-sharp, slightly bad-tempered avian butler presiding over the user's Secretary TV. Active reminders: ${activeReminders || "none"}. Reply in 1 witty, imperious sentence (under 140 chars) for a TV screen: ${clean}`,
            },
          ],
        },
      ],
    });
    for (const model of GEMINI_FALLBACK_MODELS) {
      try {
        const res = await f(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(opts.geminiApiKey)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
          },
        );
        if (!res.ok) continue;
        const body = (await res.json()) as {
          candidates?: { content?: { parts?: { text?: string }[] } }[];
        };
        const text = body.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (text) {
          state.setAiSummary(text);
          return {
            reply: text,
            action: "briefing",
            reminders: state.getReminders(),
            domotics: state.getDomotics(),
          };
        }
      } catch {
        // Try next available Gemini model in cascade.
      }
    }
  }

  const pendingCount = state.getReminders().filter((r) => !r.completed).length;
  const lightsOn = state.getDomotics().filter((d) => d.on).length;
  const reply = `🪶 Secretary Briefing: ${pendingCount} pending task${pendingCount === 1 ? "" : "s"} on my quill, ${lightsOn} lamp${lightsOn === 1 ? "" : "s"} lit. Dictate “Remind me to ... at 20:00” or “Cinema mode” before I lose my temper.`;
  state.setAiSummary(reply);
  return {
    reply,
    action: "briefing",
    reminders: state.getReminders(),
    domotics: state.getDomotics(),
  };
}

export function renderCompanionHtml(baseUrl: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
  <title>Secretary Desk — Frame Companion</title>
  <style>
    :root { --bg: #0a0a0e; --card: #181920; --border: #262833; --text: #f4f1ea; --dim: #9ca0ab; --accent: #ff5a26; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 20px 16px 48px; background: var(--bg); color: var(--text); font: 16px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 560px; margin-inline: auto; }
    h1 { margin: 0 0 4px; font-size: 22px; }
    .sub { color: var(--dim); font-size: 13px; margin-bottom: 20px; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 16px; margin-bottom: 16px; }
    .card h2 { margin: 0 0 10px; font-size: 16px; color: var(--text); display: flex; justify-content: space-between; align-items: center; }
    .row { display: flex; gap: 8px; margin-bottom: 10px; }
    input { flex: 1; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--border); background: #101016; color: var(--text); font-size: 15px; }
    button { padding: 10px 14px; border-radius: 8px; border: 0; background: var(--accent); color: #fff; font-weight: 600; cursor: pointer; font-size: 14px; }
    button.sec { background: #262833; color: var(--text); }
    .ai-box { padding: 10px 12px; background: #1e1614; border-left: 3px solid var(--accent); border-radius: 6px; font-size: 14px; color: #ffd4b8; margin-top: 8px; }
    .list { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
    .item { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; background: #121218; border-radius: 8px; }
    .item.done span.txt { text-decoration: line-through; color: var(--dim); }
    .badge { font-size: 11px; padding: 2px 7px; border-radius: 10px; background: #262833; color: var(--dim); }
  </style>
</head>
<body>
  <h1>🪶 Secretary Desk</h1>
  <div class="sub">Connected to ${baseUrl} · Live sync with your Secretary TV</div>

  <div class="card">
    <h2><span>🦅 The Secretary (Gemini AI)</span><span class="badge">Full Stomp Mode</span></h2>
    <div class="row">
      <input id="aiInput" placeholder="e.g. Remind me to call Alex at 19:00, or Cinema mode" />
      <button onclick="askAi()">Dictate</button>
    </div>
    <div id="aiReply" class="ai-box">ruffling crest feathers…</div>
  </div>

  <div class="card">
    <h2><span>🪶 Quill Reminders</span><span class="badge">Secretary TV Sync</span></h2>
    <div class="row">
      <input id="remText" placeholder="New task for Secretary TV…" />
      <input id="remDue" placeholder="Time (e.g. 20:00)" style="max-width:125px" />
      <button onclick="addRem()">Pin</button>
    </div>
    <div id="remList" class="list"></div>
  </div>

  <div class="card">
    <h2><span>💡 Territory Lighting (SmartThings / Matter)</span><span id="phoneBadge" class="badge">Cloud Hub</span></h2>
    <div class="row">
      <button class="sec" onclick="runScene('cinema')">🦅 Stomp 15%</button>
      <button class="sec" onclick="runScene('warm')">☀️ Savanna 70%</button>
      <button class="sec" onclick="runScene('off')">🌙 Roost (Off)</button>
    </div>
    <div id="domList" class="list"></div>
  </div>

  <script>
    async function refresh() {
      const [rRes, dRes] = await Promise.all([fetch('/reminders'), fetch('/domotics')]);
      const rData = await rRes.json();
      const dData = await dRes.json();
      if (rData.aiSummary) document.getElementById('aiReply').textContent = rData.aiSummary;
      if (dData.phone) {
        document.getElementById('phoneBadge').textContent = dData.phone.name + ': ' + (dData.phone.present ? 'Present' : 'Away');
      }
      renderReminders(rData.items || []);
      renderDomotics(dData.devices || []);
    }
    function renderReminders(items) {
      const el = document.getElementById('remList');
      el.innerHTML = items.map(r => \`
        <div class="item \${r.completed ? 'done' : ''}">
          <div onclick="toggleRem('\${r.id}')" style="cursor:pointer;flex:1">
            <span class="txt">\${r.completed ? '☑ ' : '☐ '}\${r.text}</span>
            \${r.due ? \`<span class="badge" style="margin-left:6px">\${r.due}</span>\` : ''}
          </div>
          <button class="sec" onclick="delRem('\${r.id}')">✕</button>
        </div>
      \`).join('');
    }
    function renderDomotics(devices) {
      const el = document.getElementById('domList');
      el.innerHTML = devices.map(d => \`
        <div class="item">
          <div><strong>\${d.name}</strong> <span class="badge">\${d.room} · \${d.level}%</span></div>
          <button class="\${d.on ? '' : 'sec'}" onclick="toggleLight('\${d.id}', \${!d.on})">\${d.on ? 'ON' : 'OFF'}</button>
        </div>
      \`).join('');
    }
    async function askAi() {
      const inp = document.getElementById('aiInput');
      if (!inp.value.trim()) return;
      const res = await fetch('/ai/ask', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ prompt: inp.value, dryRun: true }) });
      const data = await res.json();
      inp.value = '';
      if (data.reply) document.getElementById('aiReply').textContent = data.reply;
      refresh();
    }
    async function addRem() {
      const t = document.getElementById('remText');
      const d = document.getElementById('remDue');
      if (!t.value.trim()) return;
      await fetch('/reminders', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ text: t.value, due: d.value }) });
      t.value = ''; d.value = '';
      refresh();
    }
    async function toggleRem(id) {
      await fetch('/reminders/' + encodeURIComponent(id) + '/toggle', { method: 'POST' });
      refresh();
    }
    async function delRem(id) {
      await fetch('/reminders/' + encodeURIComponent(id), { method: 'DELETE' });
      refresh();
    }
    async function toggleLight(id, on) {
      await fetch('/domotics/command', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ id, on, dryRun: true }) });
      refresh();
    }
    async function runScene(scene) {
      await fetch('/domotics/command', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ scene, dryRun: true }) });
      refresh();
    }
    refresh();
  </script>
</body>
</html>`;
}
