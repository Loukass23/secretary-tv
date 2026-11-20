import { MAX_PROFILES } from "./config.ts";
import type { Session } from "./session.ts";

// What Nest hands a catalog app when it launches it, as one Tizen app-control data entry (the apps are separate
// packages and share no storage). Nest launches the app directly by id, so no other app can send or read it.

/** The app-control data key. */
export const LAUNCH_KEY = "secretary";

export type OpenKind = "movie" | "series" | "anime";

export interface OpenTitle {
  type: OpenKind;
  /** The catalog title as the apps store it (at least an id and a name). */
  title: { id: string; name: string };
  autoPlay: boolean;
  /** A watch-party code (docs/watch-party.md): join that room, which then decides the episode and the release. */
  room?: string;
}

/**
 * Play at once (docs/embedding-catalog.md): what the embedded catalog already found (the title, the episode, the sources in
 * the order to try them and where to start), so the app opens its player without searching again. The sources are
 * the provider's own records and stay opaque here; the app reads what it needs.
 */
export interface PlayNow {
  type: OpenKind;
  title: { id: string; name: string } & Record<string, unknown>;
  episode?: ({ id: string } & Record<string, unknown>) | null;
  streams: ({ url: string } & Record<string, unknown>)[];
  /** Seconds to start from. */
  start: number;
  /** The viewer picked the first source by hand. */
  manual?: boolean;
}

/** More sources than this are not carried: the first ones are the ones that would be tried. */
export const PLAY_STREAMS_MAX = 8;

/** The room service's code alphabet (party/src/protocol.ts CODE_ALPHABET), six characters. */
const ROOM_CODE = /^[2-9A-HJKMNP-Z]{6}$/;

/**
 * SmartThings for the app's movie lights (docs/smartthings.md): an access token Nest holds the refresh for (good for
 * up to 24 h, so the app never refreshes and never spends Nest's single-use refresh token), and the scenes to run.
 */
export interface HomeGrant {
  token: string;
  /** Epoch ms when the token expires. */
  exp: number;
  /** Scene run when playback starts. */
  movie?: string;
  /** Scene run when the player closes. */
  restore?: string;
}

export interface LaunchPayload {
  v: 1;
  /** A session of the app's own (see mintAppSession) and the profile to use. */
  grant?: { session: Session; profile: number };
  /** Open this title's detail page (and play it when autoPlay). */
  open?: OpenTitle;
  /** Play this now, with the sources already found. */
  play?: PlayNow;
  /** Open this folder of one of the profile's collections (a Nest home card). */
  folder?: { collectionId: string; folderId: string };
  home?: HomeGrant;
  /** Epoch ms when Nest sent it: an app ignores a payload it has already applied. */
  at: number;
}

export const encodeLaunch = (p: Omit<LaunchPayload, "v">): string => JSON.stringify({ v: 1, ...p });

const isSession = (s: unknown): s is Session => {
  const x = s as Session | null;
  return Boolean(
    x && typeof x.access === "string" && x.access && typeof x.refresh === "string" && x.refresh &&
      typeof x.exp === "number" && typeof x.userId === "string" && x.anonymous === false,
  );
};

/** The payload from the app-control value, or null when it is missing, malformed or from another version. */
export function decodeLaunch(raw: unknown): LaunchPayload | null {
  let p: Partial<LaunchPayload> | null;
  try {
    p = typeof raw === "string" ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
  if (!p || p.v !== 1 || typeof p.at !== "number") return null;
  const out: LaunchPayload = { v: 1, at: p.at };
  const g = p.grant;
  if (g && isSession(g.session) && Number.isInteger(g.profile) && g.profile >= 1 && g.profile <= MAX_PROFILES) {
    out.grant = { session: g.session, profile: g.profile };
  }
  const o = p.open;
  if (o && (o.type === "movie" || o.type === "series" || o.type === "anime") && typeof o.title?.id === "string" && o.title.id) {
    out.open = { type: o.type, title: { ...o.title, name: String(o.title.name ?? "") }, autoPlay: o.autoPlay === true };
    if (typeof o.room === "string" && ROOM_CODE.test(o.room)) out.open.room = o.room;
  }
  const pl = p.play;
  if (
    pl &&
    (pl.type === "movie" || pl.type === "series" || pl.type === "anime") &&
    typeof pl.title?.id === "string" && pl.title.id &&
    Array.isArray(pl.streams)
  ) {
    const streams = pl.streams.filter((s) => s && typeof s.url === "string" && s.url).slice(0, PLAY_STREAMS_MAX);
    if (streams.length) {
      out.play = {
        type: pl.type,
        title: { ...pl.title, name: String(pl.title.name ?? "") },
        episode: pl.episode && typeof pl.episode.id === "string" ? pl.episode : null,
        streams,
        start: typeof pl.start === "number" && pl.start > 0 ? pl.start : 0,
        manual: pl.manual === true,
      };
    }
  }
  const f = p.folder;
  if (f && typeof f.collectionId === "string" && f.collectionId && typeof f.folderId === "string" && f.folderId) {
    out.folder = { collectionId: f.collectionId, folderId: f.folderId };
  }
  const h = p.home;
  if (h && typeof h.token === "string" && h.token && typeof h.exp === "number") {
    out.home = { token: h.token, exp: h.exp };
    if (typeof h.movie === "string" && h.movie) out.home.movie = h.movie;
    if (typeof h.restore === "string" && h.restore) out.home.restore = h.restore;
  }
  return out;
}

/** Reads this app's launch payload on the TV (Tizen app-control); null elsewhere. */
export function readLaunch(): LaunchPayload | null {
  try {
    const tizen = (globalThis as { tizen?: { application?: { getCurrentApplication(): { getRequestedAppControl(): { appControl: { data: { key: string; value: string[] }[] } } } } } }).tizen;
    const req = tizen?.application?.getCurrentApplication().getRequestedAppControl();
    const entry = req?.appControl.data.find((d) => d.key === LAUNCH_KEY);
    return entry ? decodeLaunch(entry.value[0]) : null;
  } catch {
    return null;
  }
}
