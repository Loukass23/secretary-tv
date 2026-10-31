/** Synchronous key-value storage (localStorage on the TV, a Map in tests). */
export interface KV {
  get<T>(key: string): T | null;
  set(key: string, value: unknown): void;
}

export interface Session {
  access: string;
  refresh: string;
  /** Epoch ms when `access` stops working. */
  exp: number;
  userId: string;
  /** Before a QR sign-in completes, the TV holds an anonymous session to call the login RPCs. */
  anonymous: boolean;
}

/** A KV that lives only as long as the page (a session being made for another app). */
export function memoryKv(): KV {
  const map = new Map<string, string>();
  return {
    get: <T>(k: string) => (map.has(k) ? (JSON.parse(map.get(k)!) as T) : null),
    set: (k, v) => void map.set(k, JSON.stringify(v)),
  };
}

const SESSION = "sectv.nuvio.session";
const PROFILE = "sectv.nuvio.profile";

/** The JWT payload, or an empty object when the token is not one. */
export function jwtClaims(token: string): Record<string, unknown> {
  try {
    const part = token.split(".")[1] ?? "";
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const claims = JSON.parse(new TextDecoder().decode(bytes));
    return claims && typeof claims === "object" ? claims : {};
  } catch {
    return {};
  }
}

interface TokenBody {
  access_token?: string;
  accessToken?: string;
  refresh_token?: string;
  refreshToken?: string;
  expires_in?: number;
  expires_at?: number;
  user?: { id?: string; is_anonymous?: boolean };
  session?: TokenBody;
}

/** auth/v1 token responses and the QR exchange (which may nest them under `session`, camel-cased) to a Session. */
export function toSession(body: unknown, now: number, anonymous?: boolean): Session | null {
  let b = body as TokenBody | null;
  if (b?.session && !b.access_token && !b.accessToken) b = b.session;
  const access = b?.access_token ?? b?.accessToken;
  const refresh = b?.refresh_token ?? b?.refreshToken;
  if (!access || !refresh) return null;
  const claims = jwtClaims(access);
  const exp =
    typeof b?.expires_at === "number"
      ? b.expires_at * 1000
      : typeof b?.expires_in === "number"
        ? now + b.expires_in * 1000
        : typeof claims.exp === "number"
          ? claims.exp * 1000
          : now + 3600_000;
  const userId = b?.user?.id ?? (typeof claims.sub === "string" ? claims.sub : "");
  return {
    access,
    refresh,
    exp,
    userId,
    anonymous: anonymous ?? (b?.user?.is_anonymous === true || claims.is_anonymous === true),
  };
}

/** The signed-in session and the chosen profile, persisted so the TV stays signed in. */
export function createSessionStore(kv: KV) {
  let session = kv.get<Session>(SESSION);
  let profile = kv.get<number>(PROFILE) ?? 1;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const l of listeners) l();
  };
  return {
    get: (): Session | null => session,
    set(next: Session | null): void {
      const wasUser = Boolean(session && !session.anonymous);
      const changedUser = session?.userId !== next?.userId;
      session = next;
      kv.set(SESSION, next);
      if (changedUser && wasUser) {
        profile = 1;
        kv.set(PROFILE, profile);
      }
      emit();
    },
    /** Signed in with a real account (not the anonymous one the QR flow uses). */
    signedIn: (): boolean => Boolean(session && !session.anonymous),
    profile: (): number => profile,
    setProfile(index: number): void {
      profile = index;
      kv.set(PROFILE, index);
      emit();
    },
    subscribe(l: () => void): () => void {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

export type SessionStore = ReturnType<typeof createSessionStore>;
