// The room service's HTTP side, for the TV apps (Nest and the catalog apps). Pure, so it can be imported by path into
// a Tizen app like sync.ts. docs/watch-party.md has the routes.
import type { Control, Release } from "./protocol.ts";
import type { RoomSummary } from "./room.ts";

export { normalizeCode } from "./protocol.ts";
export type { RoomSummary };

/** Where a socket goes, and when its one-use ticket stops working. */
export interface JoinBundle {
  code: string;
  /** The page the QR code points at: it shows the code and where to type it. */
  joinUrl: string;
  wsUrl: string;
  ticketExpiresAt: number;
}

export interface CreateRoom {
  /** The Nuvio profile slot (1-6) that hosts. */
  profile: number;
  /** `tt…`, `tt…:S:E` or `kitsu:N[:E]`, as sync uses them. */
  contentId: string;
  title: string;
  release: Release;
  control: Control;
  startPos?: number;
}

/** A refused call: `status` is the HTTP status, 0 for no answer at all. */
export class PartyHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface PartyApiDeps {
  /** The Worker's origin, no trailing slash. */
  url: string;
  /** The caller's Nuvio access token, or null when signed out. */
  token(): Promise<string | null>;
  fetch?: typeof fetch;
}

export function createPartyApi({ url, token, fetch: f = fetch }: PartyApiDeps) {
  const base = url.replace(/\/+$/, "");
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!base) throw new PartyHttpError(0, "watch party is not set up in this build");
    const access = await token();
    if (!access) throw new PartyHttpError(401, "signed out");
    let res: Response;
    try {
      res = await f(`${base}${path}`, {
        method,
        headers: { Authorization: `Bearer ${access}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new PartyHttpError(0, e instanceof Error ? e.message : String(e));
    }
    const out = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new PartyHttpError(res.status, out.error ?? `HTTP ${res.status}`);
    return out;
  }
  return {
    configured: Boolean(base),
    create: (body: CreateRoom) => call<JoinBundle & { room: unknown }>("POST", "/rooms", body),
    ticket: (code: string, profile: number) =>
      call<JoinBundle & { room: RoomSummary }>("POST", `/rooms/${code}/ticket`, { profile }),
    summary: (code: string) => call<RoomSummary>("GET", `/rooms/${code}`),
  };
}

export type PartyApi = ReturnType<typeof createPartyApi>;

/** What to tell the person when a call fails. */
export function partyErrorText(e: unknown): string {
  const status = e instanceof PartyHttpError ? e.status : 0;
  if (status === 404) return "No party with that code. Check the code on the host's TV.";
  if (status === 409) return "That party is full (8 TVs).";
  if (status === 429) return "Too many parties started. Try again in a minute.";
  if (status === 401 || status === 403) return "Sign in to Nuvio in Nest first.";
  if (e instanceof PartyHttpError && status === 0 && /not set up/.test(e.message)) return "Watch together is not set up in this build.";
  return "The party service did not answer. Try again.";
}

/** Which catalog app plays a room's content, and the title id its detail page opens. */
export function contentApp(contentId: string): { type: "movie" | "series" | "anime"; titleId: string } {
  const parts = contentId.split(":");
  if (parts[0] === "kitsu") return { type: "anime", titleId: parts.slice(0, 2).join(":") };
  return parts.length >= 3 ? { type: "series", titleId: parts[0] } : { type: "movie", titleId: parts[0] };
}
