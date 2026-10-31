import { cardAt, STABLE_MS } from "./upnext.ts";

/**
 * Where an episode's intro, recap and credits are, for the skip pill and the Up next card. Sources, first answer per
 * segment type: AniSkip for anime, TheIntroDB for other series, then a timed estimate of the credits, which only places
 * the Up next card and is never skipped to. Pure, with injected fetch, storage and clock.
 */

export type SegmentType = "intro" | "recap" | "credits";

export interface Segment {
  type: SegmentType;
  /** Seconds into the episode. */
  start: number;
  end: number;
  source: "aniskip" | "theintrodb" | "estimate";
}

export interface KV {
  get<T>(key: string): T | null;
  set(key: string, value: unknown): void;
}

const ARM = "https://arm.haglund.dev/api/v2";
const ANISKIP = "https://api.aniskip.com/v2";
const INTRODB = "https://api.theintrodb.org/v4";

/** An answer measured on a file whose length is off by more than this is for another cut of the episode. */
const LENGTH_TOLERANCE = 0.1;
const MAX_OPENING_SEC = 180;
const CREDITS_FROM = 0.85;

const ANISKIP_TYPES: Record<string, SegmentType> = {
  op: "intro",
  "mixed-op": "intro",
  recap: "recap",
  ed: "credits",
  "mixed-ed": "credits",
};

interface AniSkipResult {
  interval?: { startTime?: number; endTime?: number };
  skipType?: string;
  episodeLength?: number;
}

/** Whether a segment can be what it says, in an episode of `durSec`. */
export function plausible(s: Pick<Segment, "type" | "start" | "end">, durSec: number): boolean {
  if (!(s.end > s.start) || s.start < 0 || s.end > durSec + 1) return false;
  if (s.type === "credits") return s.start >= durSec * CREDITS_FROM;
  return s.start < durSec / 2 && s.end - s.start <= MAX_OPENING_SEC;
}

/**
 * AniSkip's answer to segments: per type, the result measured on the file closest in length to this one, if within
 * 10% of it, and only when the segment is plausible.
 */
export function parseAniSkip(body: unknown, durSec: number): Segment[] {
  const results = ((body as { results?: AniSkipResult[] } | null)?.results ?? []).filter(
    (r) => r.interval && typeof r.interval.startTime === "number" && typeof r.interval.endTime === "number" && r.skipType,
  );
  const out: Segment[] = [];
  for (const type of ["intro", "recap", "credits"] as const) {
    const candidates = results
      .filter((r) => ANISKIP_TYPES[r.skipType!] === type)
      .map((r) => ({ r, off: r.episodeLength ? Math.abs(r.episodeLength - durSec) / durSec : 0 }))
      .filter(({ off }) => off <= LENGTH_TOLERANCE)
      .sort((a, b) => a.off - b.off);
    for (const { r } of candidates) {
      const seg: Segment = { type, start: r.interval!.startTime!, end: r.interval!.endTime!, source: "aniskip" };
      if (plausible(seg, durSec)) {
        out.push(seg);
        break;
      }
    }
  }
  return out;
}

type IntroDbTime = { start_ms?: number | null; end_ms?: number | null };

/**
 * TheIntroDB's answer to segments: per type the first plausible one. A missing start is the episode's start and a
 * missing end its end, as the API documents.
 */
export function parseIntroDb(body: unknown, durSec: number): Segment[] {
  const b = (body ?? {}) as Partial<Record<SegmentType, IntroDbTime[]>>;
  const out: Segment[] = [];
  for (const type of ["intro", "recap", "credits"] as const) {
    for (const t of b[type] ?? []) {
      const seg: Segment = {
        type,
        start: t.start_ms != null ? t.start_ms / 1000 : 0,
        end: t.end_ms != null ? t.end_ms / 1000 : durSec,
        source: "theintrodb",
      };
      if (plausible(seg, durSec)) {
        out.push(seg);
        break;
      }
    }
  }
  return out;
}

/** Where the credits probably start when no source says: the Up next card's time (lib/upnext.ts). Card only. */
export function estimateCredits(durSec: number): Segment | null {
  const at = cardAt({ durSec, stableMs: STABLE_MS, isMovie: false });
  return at == null ? null : { type: "credits", start: at, end: durSec, source: "estimate" };
}

/** What `find` needs about the episode playing. */
export interface SkipQuery {
  /** The catalog id: "kitsu:7442:5", "tt3032476:1:2", or the show's id with `season` and `episode`. */
  id: string;
  season?: number;
  episode?: number;
  /** The real duration, once known. */
  durSec: number;
}

const STORE = "sectv.skip.v1";
const MAX_ENTRIES = 300;
const TTL_MS = 30 * 24 * 3600_000;

type Cached = { at: number; segments: Segment[] };

export function createSkipFinder({ fetch: f = fetch, kv, now = Date.now }: { fetch?: typeof fetch; kv: KV; now?: () => number }) {
  const malIds = new Map<string, Promise<number | null>>();

  /** Kitsu, AniList or MAL id to the MAL id AniSkip is keyed by (ARM). */
  function malId(source: string, id: string): Promise<number | null> {
    if (source === "mal") return Promise.resolve(Number(id) || null);
    const key = `${source}:${id}`;
    let p = malIds.get(key);
    if (!p) {
      p = f(`${ARM}/ids?source=${source}&id=${id}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((b: { myanimelist?: number | null } | null) => b?.myanimelist ?? null)
        .catch(() => null);
      malIds.set(key, p);
    }
    return p;
  }

  const load = () => kv.get<Record<string, Cached>>(STORE) ?? {};
  const save = (key: string, segments: Segment[]) => {
    const all = Object.entries({ ...load(), [key]: { at: now(), segments } })
      .sort(([, a], [, b]) => b.at - a.at)
      .slice(0, MAX_ENTRIES);
    kv.set(STORE, Object.fromEntries(all));
  };

  /** TheIntroDB answers nothing known for an episode: not asked again this session. */
  const introDbNone = new Set<string>();

  async function fromAniSkip(source: string, show: string, ep: number, durSec: number): Promise<Segment[] | null> {
    const mal = await malId(source, show);
    if (!mal) return [];
    const types = Object.keys(ANISKIP_TYPES).map((t) => `types[]=${t}`).join("&");
    const res = await f(`${ANISKIP}/skip-times/${mal}/${ep}?${types}&episodeLength=${Math.round(durSec)}`);
    // AniSkip answers 404 for an episode it has nothing on: that is a "none" to remember.
    return res.ok || res.status === 404 ? parseAniSkip(res.ok ? await res.json() : null, durSec) : null;
  }

  async function fromIntroDb(idParam: string, season: number, ep: number, durSec: number): Promise<Segment[]> {
    const key = `${idParam}:${season}:${ep}`;
    if (introDbNone.has(key)) return [];
    const res = await f(`${INTRODB}/media?${idParam}&season=${season}&episode=${ep}&duration_ms=${Math.round(durSec * 1000)}`);
    if (res.status === 404) {
      introDbNone.add(key);
      return [];
    }
    if (!res.ok) return [];
    const segments = parseIntroDb(await res.json(), durSec);
    if (!segments.length) introDbNone.add(key);
    return segments;
  }

  return {
    /**
     * The segments of an episode once its real duration is known: AniSkip for anime ids, TheIntroDB for IMDb and TMDB
     * ids, then the credits estimate when no source placed them. Found answers are kept for 30 days. Never throws.
     */
    async find({ id, season, episode, durSec }: SkipQuery): Promise<Segment[]> {
      if (!(durSec > 0)) return [];
      const parts = id.split(":");
      const anime = ["kitsu", "mal", "anilist"].includes(parts[0]);
      const base = parts[0] === "tmdb" ? parts.slice(1) : parts;
      const ep = episode ?? Number(anime ? parts[2] : base[2]);
      const se = anime ? 1 : (season ?? Number(base[1]));
      const withEstimate = (found: Segment[]) => {
        const credits = found.some((x) => x.type === "credits") ? null : estimateCredits(durSec);
        return credits ? [...found, credits] : found;
      };
      if (!ep || (!anime && !(se >= 0))) return [];
      const key = anime ? `${parts[0]}:${parts[1]}:${ep}` : `${parts[0] === "tmdb" ? "tmdb" : base[0]}:${se}:${ep}`;
      const hit = load()[key];
      if (hit && now() - hit.at < TTL_MS && now() >= hit.at) return withEstimate(hit.segments.filter((x) => plausible(x, durSec)));
      try {
        let found: Segment[] | null;
        if (anime) found = await fromAniSkip(parts[0], parts[1], ep, durSec);
        else if (/^tt\d+$/.test(base[0])) found = await fromIntroDb(`imdb_id=${base[0]}`, se, ep, durSec);
        else if (/^\d+$/.test(base[0])) found = await fromIntroDb(`tmdb_id=${base[0]}`, se, ep, durSec);
        else found = [];
        if (found?.length || (anime && found)) save(key, found);
        return withEstimate(found ?? []);
      } catch {
        return withEstimate([]);
      }
    },
  };
}

export type SkipFinder = ReturnType<typeof createSkipFinder>;

/** How long the skip pill stays up after a segment starts, unless OK is pressed. */
export const PILL_SEC = 10;

/**
 * The intro or recap the pill offers at `posSec`: one being played, within its first 10 seconds, not skipped yet.
 * Credits are not offered: with a next episode the Up next card shows there, and OK on it plays the next one.
 */
export function pillAt(segments: readonly Segment[], posSec: number, skipped: ReadonlySet<string>): Segment | null {
  return (
    segments.find(
      (s) =>
        s.type !== "credits" &&
        s.source !== "estimate" &&
        posSec >= s.start &&
        posSec < Math.min(s.end, s.start + PILL_SEC) &&
        !skipped.has(segmentKey(s)),
    ) ?? null
  );
}

/** The same segment across renders. */
export const segmentKey = (s: Segment) => `${s.type}:${Math.round(s.start)}`;

/** Where the credits start by a real source (not the estimate), for the Up next card. */
export const creditsStart = (segments: readonly Segment[]) =>
  segments.find((s) => s.type === "credits" && s.source !== "estimate")?.start ?? null;

