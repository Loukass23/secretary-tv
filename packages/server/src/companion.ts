import { type Answer, describeIntent, type LightsCommand, route, type SearchResult, type WatchIntent } from "@secretary/assistant";
import type { createStateStore, DomoticDevice, StoredReminder } from "./state.ts";

export { describeIntent, pcmToWav, speak, transcribe, VOICE_MAX_BYTES, VOICE_TYPES } from "@secretary/assistant";

type StateStore = ReturnType<typeof createStateStore>;

export interface AiCommandResult extends Answer {
  reminders: StoredReminder[];
  domotics: DomoticDevice[];
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
  const lights = async (cmd: LightsCommand) => {
    if ("scene" in cmd) {
      const prev = structuredClone(state.getDomotics());
      await forwardSmartThingsScene(opts.smartThingsToken, prev, state.applyDomoticScene(cmd.scene), opts.fetch, opts.dryRun);
      return;
    }
    const on = cmd.level > 0;
    for (const d of state.getDomotics()) {
      state.updateDomoticDevice(d.id, { on, level: cmd.level });
      await forwardSmartThingsCommand(opts.smartThingsToken, d.id, { on, level: cmd.level }, opts.fetch, opts.dryRun);
    }
  };
  const answer = await route(prompt, {
    addReminder: (text, due) => state.addReminder({ text, due, source: "gemini" }),
    openReminders: () => state.getReminders().filter((r) => !r.completed).map((r) => r.text),
    lights,
    lightsOn: () => state.getDomotics().filter((d) => d.on).length,
    find: opts.find,
    geminiKey: opts.geminiApiKey,
    fetch: opts.fetch,
  });
  if (answer.action !== "watch") state.setAiSummary(answer.reply);
  return { ...answer, reminders: state.getReminders(), domotics: state.getDomotics() };
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
      <button id="talkBtn" class="sec" title="Hold and speak (a Bluetooth speakerphone paired to this phone works too)">🎤 Hold</button>
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
    // The server's own path: /<key> when hosted, empty at home.
    const API = ${JSON.stringify(new URL(baseUrl).pathname.replace(/\/$/, ""))};
    async function refresh() {
      const [rRes, dRes] = await Promise.all([fetch(API + '/reminders'), fetch(API + '/domotics')]);
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
    async function askAi(spoken) {
      const inp = document.getElementById('aiInput');
      if (!inp.value.trim()) return;
      const res = await fetch(API + '/ai/ask', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ prompt: inp.value, dryRun: true, speak: Boolean(spoken) }) });
      const data = await res.json();
      inp.value = '';
      if (data.reply) document.getElementById('aiReply').textContent = data.reply;
      if (data.speech) new Audio(data.speech).play().catch(() => {});
      refresh();
    }
    // Hold to talk: records 16 kHz WAV (Gemini does not list WebM), /ai/transcribe turns it into words, askAi sends them.
    // Browsers only open the microphone on https or localhost.
    const talk = { held: false, ctx: null, src: null, node: null, stream: null, frames: [] };
    async function talkStart(e) {
      e.preventDefault();
      if (talk.ctx) return;
      talk.held = true;
      const reply = document.getElementById('aiReply');
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        talk.ctx = new (window.AudioContext || window.webkitAudioContext)();
        talk.src = talk.ctx.createMediaStreamSource(stream);
        talk.node = talk.ctx.createScriptProcessor(4096, 1, 1);
        talk.frames = [];
        talk.stream = stream;
        talk.node.onaudioprocess = (ev) => talk.frames.push(new Float32Array(ev.inputBuffer.getChannelData(0)));
        talk.src.connect(talk.node);
        talk.node.connect(talk.ctx.destination);
        reply.textContent = 'Listening…';
        // Let go before the microphone opened: end at once.
        if (!talk.held) talkStop();
      } catch {
        reply.textContent = location.protocol === 'https:' || location.hostname === 'localhost'
          ? 'No microphone allowed.' : 'The microphone needs https.';
      }
    }
    async function talkStop() {
      talk.held = false;
      if (!talk.ctx) return;
      const rate = talk.ctx.sampleRate;
      talk.node.disconnect(); talk.src.disconnect(); talk.ctx.close();
      talk.stream.getTracks().forEach((t) => t.stop());
      talk.ctx = null;
      const reply = document.getElementById('aiReply');
      const n = talk.frames.reduce((s, f) => s + f.length, 0);
      if (n < rate / 4) { reply.textContent = 'Hold the button while you speak.'; return; }
      const all = new Float32Array(n);
      let at = 0;
      for (const f of talk.frames) { all.set(f, at); at += f.length; }
      reply.textContent = 'Listening done, thinking…';
      const res = await fetch(API + '/ai/transcribe', { method: 'POST', headers: {'content-type':'audio/wav'}, body: toWav(all, rate) });
      if (!res.ok) {
        reply.textContent = res.status === 503 ? 'Voice needs GEMINI_API_KEY on the server.' : "Didn't catch that.";
        return;
      }
      document.getElementById('aiInput').value = (await res.json()).transcript;
      askAi(true);
    }
    function toWav(samples, from) {
      const ratio = Math.max(1, from / 16000);
      const len = Math.floor(samples.length / ratio);
      const v = new DataView(new ArrayBuffer(44 + len * 2));
      const str = (at, s) => { for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i)); };
      const rate = Math.round(from / ratio);
      str(0, 'RIFF'); v.setUint32(4, 36 + len * 2, true); str(8, 'WAVEfmt ');
      v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
      str(36, 'data'); v.setUint32(40, len * 2, true);
      for (let i = 0; i < len; i++) {
        const s = Math.max(-1, Math.min(1, samples[Math.floor(i * ratio)]));
        v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      }
      return v.buffer;
    }
    const talkBtn = document.getElementById('talkBtn');
    talkBtn.addEventListener('pointerdown', talkStart);
    talkBtn.addEventListener('pointerup', talkStop);
    talkBtn.addEventListener('pointerleave', talkStop);
    async function addRem() {
      const t = document.getElementById('remText');
      const d = document.getElementById('remDue');
      if (!t.value.trim()) return;
      await fetch(API + '/reminders', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ text: t.value, due: d.value }) });
      t.value = ''; d.value = '';
      refresh();
    }
    async function toggleRem(id) {
      await fetch(API + '/reminders/' + encodeURIComponent(id) + '/toggle', { method: 'POST' });
      refresh();
    }
    async function delRem(id) {
      await fetch(API + '/reminders/' + encodeURIComponent(id), { method: 'DELETE' });
      refresh();
    }
    async function toggleLight(id, on) {
      await fetch(API + '/domotics/command', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ id, on, dryRun: true }) });
      refresh();
    }
    async function runScene(scene) {
      await fetch(API + '/domotics/command', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ scene, dryRun: true }) });
      refresh();
    }
    refresh();
  </script>
</body>
</html>`;
}
