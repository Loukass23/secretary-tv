import { createTorbox, rank, type Candidate } from "@secretary/core";
import {
  forwardSmartThingsCommand,
  forwardSmartThingsScene,
  handleAiPrompt,
  renderCompanionHtml,
  type SmartThingsPhonePresence,
  speak,
  syncSmartThingsDevices,
  transcribe,
  VOICE_MAX_BYTES,
  VOICE_TYPES,
} from "./companion.ts";
import { type EpisodeHint, episodeHint, pickFile } from "./files.ts";
import { discoverCatalog, rankSearch, searchCatalogs, type SearchResult } from "./search.ts";
import { type Weather, fetchWeather, type WeatherPlace } from "./weather.ts";
import {
  type CatalogKind,
  createStateStore,
  type DomoticDevice,
  isCatalogKind,
  type SlimTitle,
  type StoredReminder,
  type StoredResumeEntry,
} from "./state.ts";

export { episodeHint, matchesAbsolute, matchesEpisode, pickFile } from "./files.ts";
export { rankSearch, searchCatalogs, type SearchResult } from "./search.ts";
export {
  createStateStore,
  type CatalogKind,
  type DomoticDevice,
  type SlimTitle,
  type StoredReminder,
  type StoredResumeEntry,
} from "./state.ts";

export interface AppConfig {
  apiKey: string;
  /** Public base URL the TV reaches this server at, no trailing slash. */
  baseUrl: string;
  /** Stremio addon used as the hash source, no trailing slash. Empty: the TV finds streams with its plugins. */
  upstream: string;
  /** Optional path to persist watch progress across server restarts. */
  stateFile?: string;
  /** Optional Google Gemini API key for the Companion / Frame AI assistant. */
  geminiApiKey?: string;
  /** Optional Samsung SmartThings Cloud Hub bearer token. */
  smartThingsToken?: string;
  /** Where Nest's weather is for: coordinates, or a city name looked up once. Absent: no weather. */
  weather?: WeatherPlace;
  fetch?: typeof fetch;
  /** Milliseconds clock, injectable for tests. */
  now?: () => number;
}

interface UpstreamStream {
  name?: string;
  title?: string;
  infoHash?: string;
  fileIdx?: number;
}

const MANIFEST = {
  id: "app.secretary-tv",
  version: "0.0.1",
  name: "Secretary TV",
  description: "Cached debrid streams, ranked for TVs",
  resources: ["stream"],
  types: ["movie", "series"],
  idPrefixes: ["tt", "kitsu"],
  catalogs: [],
};

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type",
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });

const STREAM_TTL_MS = 5 * 60_000;
const WEATHER_TTL_MS = 10 * 60_000;
/** Image hosts /art passes through, so Nest can read an artwork's colour (they send no CORS headers). */
const ART_HOSTS = /(?:^|\.)(?:metahub\.space|kitsu\.app|kitsu\.io|tmdb\.org|fanart\.tv)$/;
const LINK_TTL_MS = 30 * 60_000;

/** Tiny TTL cache that also shares an in-flight promise between callers. */
function ttlCache<T>(ttl: number, now: () => number) {
  const m = new Map<string, { at: number; v: Promise<T> }>();
  return (key: string, make: () => Promise<T>): Promise<T> => {
    const t = now();
    const hit = m.get(key);
    if (hit && t - hit.at < ttl) return hit.v;
    if (m.size >= 256) {
      for (const [k, entry] of m) if (t - entry.at >= ttl) m.delete(k);
    }
    const v = make();
    m.set(key, { at: t, v });
    v.catch(() => m.delete(key));
    return v;
  };
}

export function createApp(cfg: AppConfig) {
  const f = cfg.fetch ?? fetch;
  const now = cfg.now ?? Date.now;
  const streamCache = ttlCache<unknown>(STREAM_TTL_MS, now);
  const linkCache = ttlCache<string | null>(LINK_TTL_MS, now);
  const searchCache = ttlCache<SearchResult[]>(STREAM_TTL_MS, now);
  const cloudCache = ttlCache<unknown>(STREAM_TTL_MS, now);
  const stSyncCache = ttlCache<{ devices: DomoticDevice[]; phone?: SmartThingsPhonePresence }>(
    STREAM_TTL_MS,
    now,
  );
  const weatherCache = ttlCache<Weather | null>(WEATHER_TTL_MS, now);
  const state = createStateStore(cfg.stateFile, now);
  const torbox = createTorbox({ apiKey: cfg.apiKey, fetch: f });

  const streams = async (type: string, id: string): Promise<Response> =>
    json(await streamCache(`${type}/${id}`, () => streamsBody(type, id)));

  async function streamsBody(type: string, id: string): Promise<unknown> {
    if (!cfg.upstream) return { streams: [] };
    const hint = episodeHint(id);
    const upstreamType = type === "series" && /^tt\d+$/.test(id) ? "movie" : type;
    const res = await f(`${cfg.upstream}/stream/${upstreamType}/${id}.json`);
    if (!res.ok) return { streams: [] };
    const { streams: raw = [] } = (await res.json()) as { streams?: UpstreamStream[] };

    const withHash = raw.filter((s) => s.infoHash);
    const cached = await torbox.checkCached(withHash.map((s) => s.infoHash!.toLowerCase()));

    const byHash = new Map<string, UpstreamStream>();
    const candidates: Candidate[] = [];
    for (const s of withHash) {
      const hash = s.infoHash!.toLowerCase();
      if (!cached.has(hash) || byHash.has(hash)) continue;
      byHash.set(hash, s);
      candidates.push({ hash, name: `${s.title ?? ""} ${s.name ?? ""}`, cached: true });
    }

    return {
      streams: rank(candidates).map((c) => {
        const s = byHash.get(c.hash)!;
        return {
          name: "TorBox",
          title: (s.title ?? c.name).split("\n")[0],
          url: `${cfg.baseUrl}/resolve/${c.hash}${s.fileIdx == null ? "" : `/${s.fileIdx}`}${hint ? `?s=${hint.season}&e=${hint.episode}` : ""}`,
        };
      }),
    };
  }

  async function resolve(
    hash: string,
    fileIdx: number | undefined,
    hint: EpisodeHint | null,
  ): Promise<Response> {
    const hintKey = hint ? `${hint.season ?? ""}x${hint.episode ?? ""}a${hint.absolute ?? ""}` : "";
    const url = await linkCache(`${hash}/${fileIdx ?? ""}/${hintKey}`, () => resolveUrl(hash, fileIdx, hint));
    if (!url) return json({ error: "no files" }, 404);
    return new Response(null, { status: 302, headers: { location: url } });
  }

  async function resolveUrl(
    hash: string,
    fileIdx: number | undefined,
    hint: EpisodeHint | null,
  ): Promise<string | null> {
    const torrentId = await torbox.createTorrent(hash);
    const files = await torbox.listFiles(torrentId);
    const file = pickFile(files, fileIdx, hint);
    if (!file) return null;
    return torbox.requestDownload(torrentId, file.id);
  }

  /** Runs a prompt for Nest or Desk; /ai/state shows it as pending until the answer lands. */
  async function ask(prompt: string, source: "tv" | "companion", dryRun: boolean) {
    state.beginAsk(prompt, source);
    let result;
    try {
      result = await handleAiPrompt(prompt, state, {
        geminiApiKey: cfg.geminiApiKey ?? process.env.GEMINI_API_KEY,
        smartThingsToken: cfg.smartThingsToken ?? process.env.SMARTTHINGS_TOKEN,
        dryRun,
        fetch: f,
        find: (intent) =>
          intent.term
            ? searchCache(intent.term.toLowerCase(), () => searchCatalogs(intent.term!, f)).then((r) =>
                intent.kind ? r.filter((x) => x.type === intent.kind) : r,
              )
            : searchCache(`discover:${intent.kind ?? ""}:${intent.genre ?? ""}`, () =>
                discoverCatalog(intent.kind, intent.genre, f),
              ),
      });
    } catch (e) {
      state.endAsk({ prompt, source, reply: "Something went wrong; try again.", action: "error" });
      throw e;
    }
    const turn = state.endAsk({
      prompt,
      source,
      reply: result.reply,
      action: result.action,
      query: result.query,
      results: result.results,
    });
    return { ...result, turn };
  }

  return async function handle(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const { pathname, searchParams } = new URL(req.url);
    try {
      if (pathname === "/manifest.json") return json(MANIFEST);
      if (pathname === "/health" && req.method === "GET") {
        return json({
          ok: true,
          resumeCount: state.getAllResume().length,
          reminderCount: state.getReminders().filter((r) => !r.completed).length,
          companionUrl: `${cfg.baseUrl}/companion`,
        });
      }
      if ((pathname === "/companion" || pathname === "/remote") && req.method === "GET") {
        return new Response(renderCompanionHtml(cfg.baseUrl), {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8", ...CORS },
        });
      }
      if (pathname === "/reminders") {
        if (req.method === "GET") {
          return json({ items: state.getReminders(), aiSummary: state.getAiSummary() });
        }
        if (req.method === "POST") {
          const body = (await req.json()) as {
            text?: string;
            due?: string;
            source?: "companion" | "gemini" | "local";
          };
          if (!body?.text?.trim()) return json({ error: "missing reminder text" }, 400);
          const items = state.addReminder({
            text: body.text,
            due: body.due,
            source: body.source ?? "companion",
          });
          return json({ items, aiSummary: state.getAiSummary() });
        }
      }
      let m = pathname.match(/^\/reminders\/([^/]+)\/toggle$/);
      if (m && req.method === "POST") {
        const items = state.toggleReminder(decodeURIComponent(m[1]));
        return json({ items });
      }
      m = pathname.match(/^\/reminders\/([^/]+)$/);
      if (m && req.method === "DELETE") {
        const items = state.deleteReminder(decodeURIComponent(m[1]));
        return json({ items });
      }
      if (pathname === "/ai/ask" && req.method === "POST") {
        const body = (await req.json()) as { prompt?: string; dryRun?: boolean; source?: string; speak?: boolean };
        const prompt = body?.prompt?.trim();
        if (!prompt) return json({ error: "missing prompt" }, 400);
        const out = await ask(prompt, body.source === "tv" ? "tv" : "companion", Boolean(body.dryRun));
        // speak: the reply read aloud too, for a room speaker (null without a speech model).
        if (!body.speak) return json(out);
        const key = cfg.geminiApiKey ?? process.env.GEMINI_API_KEY;
        const wav = key ? await speak(out.reply, key, f, process.env.GEMINI_TTS_MODEL) : null;
        return json({ ...out, speech: wav ? `data:audio/wav;base64,${Buffer.from(wav).toString("base64")}` : null });
      }
      // A spoken prompt from Nest or Desk: the words only. The caller then sends them to /ai/ask like typed ones, so
      // prompts the TV answers itself ("dark mode") never reach the lights.
      if (pathname === "/ai/transcribe" && req.method === "POST") {
        const key = cfg.geminiApiKey ?? process.env.GEMINI_API_KEY;
        if (!key) return json({ error: "voice needs GEMINI_API_KEY" }, 503);
        const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
        if (!VOICE_TYPES.includes(type)) return json({ error: "unsupported audio" }, 415);
        const audio = new Uint8Array(await req.arrayBuffer());
        if (!audio.length) return json({ error: "missing audio" }, 400);
        if (audio.length > VOICE_MAX_BYTES) return json({ error: "clip too long" }, 413);
        const transcript = await transcribe(audio, type === "audio/x-wav" ? "audio/wav" : type, key, f);
        return transcript ? json({ transcript }) : json({ error: "no speech" }, 422);
      }
      if (pathname === "/ai/state" && req.method === "GET") {
        return json(state.getAssistant());
      }
      if (pathname === "/weather" && req.method === "GET") {
        if (!cfg.weather) return json({ error: "weather not configured" }, 404);
        const w = await weatherCache("now", () => fetchWeather(cfg.weather!, f));
        return w ? json(w) : json({ error: "weather unavailable" }, 502);
      }
      if (pathname === "/art" && req.method === "GET") {
        let u: URL;
        try {
          u = new URL(searchParams.get("u") ?? "");
        } catch {
          return json({ error: "bad url" }, 400);
        }
        if (u.protocol !== "https:" || !ART_HOSTS.test(u.hostname)) return json({ error: "host not allowed" }, 403);
        const res = await f(u.toString());
        const type = res.headers.get("content-type") ?? "";
        if (!res.ok || !type.startsWith("image/")) return json({ error: "no image" }, 502);
        return new Response(res.body, {
          status: 200,
          headers: { "content-type": type, "cache-control": "public, max-age=86400", ...CORS },
        });
      }
      if (pathname === "/domotics" && req.method === "GET") {
        const stToken = cfg.smartThingsToken ?? process.env.SMARTTHINGS_TOKEN;
        const synced = await stSyncCache("st-devices", () =>
          syncSmartThingsDevices(stToken, state, f),
        );
        return json({ devices: state.getDomotics(), phone: synced.phone });
      }
      if (pathname === "/domotics/command" && req.method === "POST") {
        const body = (await req.json()) as {
          id?: string;
          on?: boolean;
          level?: number;
          scene?: "cinema" | "warm" | "off";
          targetIds?: string[];
          dryRun?: boolean;
        };
        if (body.scene) {
          const prevDevices = structuredClone(state.getDomotics());
          const devices = state.applyDomoticScene(body.scene, body.targetIds);
          await forwardSmartThingsScene(
            cfg.smartThingsToken ?? process.env.SMARTTHINGS_TOKEN,
            prevDevices,
            devices,
            f,
            Boolean(body.dryRun),
            body.targetIds,
          );
          return json({ devices, simulated: Boolean(body.dryRun) });
        }
        if (!body.id) return json({ error: "missing device id or scene" }, 400);
        const updated = state.updateDomoticDevice(body.id, { on: body.on, level: body.level });
        if (!updated) return json({ error: "device not found" }, 404);
        await forwardSmartThingsCommand(
          cfg.smartThingsToken ?? process.env.SMARTTHINGS_TOKEN,
          body.id,
          { on: body.on, level: body.level },
          f,
          Boolean(body.dryRun),
        );
        return json({ device: updated, devices: state.getDomotics(), simulated: Boolean(body.dryRun) });
      }
      if (pathname === "/cloud" && req.method === "GET") {
        const items = await cloudCache("mylist", async () => {
          const list = await torbox.listCloud();
          return list.slice(0, 24).map((t) => ({
            id: t.id,
            hash: t.hash,
            name: t.name,
            size: t.size,
            url: `${cfg.baseUrl}/resolve/${t.hash}`,
          }));
        });
        return json({ items });
      }
      if (pathname === "/resume" && req.method === "GET") {
        return json({ items: state.getAllResume() });
      }
      m = pathname.match(/^\/resume\/([^/]+)$/);
      if (m && isCatalogKind(m[1])) {
        const kind = m[1];
        if (req.method === "GET") return json({ items: state.getResume(kind) });
        if (req.method === "PUT" || req.method === "POST") {
          const body = (await req.json()) as { items?: StoredResumeEntry[] } | StoredResumeEntry[];
          const list = Array.isArray(body) ? body : (body?.items ?? []);
          return json({ items: state.putResume(kind, list) });
        }
      }
      if (pathname === "/handoff" && req.method === "POST") {
        const body = (await req.json()) as { type?: string; title?: SlimTitle; autoPlay?: boolean };
        if (!body?.type || !isCatalogKind(body.type) || !body.title?.id) {
          return json({ error: "invalid handoff" }, 400);
        }
        state.setHandoff(body.type, body.title, body.autoPlay);
        return json({ ok: true });
      }
      m = pathname.match(/^\/handoff\/([^/]+)$/);
      if (m && isCatalogKind(m[1]) && req.method === "GET") {
        const hit = state.consumeHandoffEntry(m[1]);
        return json({ title: hit?.title ?? null, autoPlay: Boolean(hit?.autoPlay) });
      }
      if (pathname === "/search" && req.method === "GET") {
        const q = (searchParams.get("q") ?? "").trim();
        if (!q) return json({ results: [] });
        const results = await searchCache(q.toLowerCase(), () => searchCatalogs(q, f));
        return json({ results });
      }
      m = pathname.match(/^\/stream\/([^/]+)\/(.+)\.json$/);
      if (m) return await streams(m[1], decodeURIComponent(m[2]));
      m = pathname.match(/^\/resolve\/([0-9a-f]{40})(?:\/(\d+))?$/);
      if (m) {
        const num = (k: string) => {
          const v = searchParams.get(k);
          return v != null && /^\d+$/.test(v) ? Number(v) : undefined;
        };
        const [season, episode, absolute] = [num("s"), num("e"), num("a")];
        const hint =
          season != null || episode != null || absolute != null ? { season, episode, absolute } : null;
        return await resolve(m[1], m[2] == null ? undefined : Number(m[2]), hint);
      }
      return json({ error: "not found" }, 404);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : "error" }, 502);
    }
  };
}
