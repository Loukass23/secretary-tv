/** Synchronous key-value storage (localStorage on the TV, a Map in tests). */
export interface KV {
  get<T>(key: string): T | null;
  set(key: string, value: unknown): void;
}

export const SIMKL_API = "https://api.simkl.com";
const TOKEN = "sectv.simkl.token";

export class SimklError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface SimklClient {
  readonly clientId: string;
  /** Signed in: a token is stored. Simkl tokens do not expire; a 401 clears it. */
  signedIn(): boolean;
  setToken(token: string | null): void;
  /** An authorised call; throws `SimklError` on a non-2xx answer. */
  call<T>(path: string, init?: { method?: "GET" | "POST"; body?: unknown }): Promise<T>;
  /** A call without the token (the PIN sign-in). */
  open<T>(path: string): Promise<T>;
}

export function createSimkl({ clientId, kv, fetch: f = fetch }: { clientId: string; kv: KV; fetch?: typeof fetch }): SimklClient {
  const token = () => kv.get<string>(TOKEN);
  const headers = (auth: boolean): Record<string, string> => {
    const h: Record<string, string> = { "Content-Type": "application/json", "simkl-api-key": clientId };
    const t = token();
    if (auth && t) h.Authorization = `Bearer ${t}`;
    return h;
  };
  async function send<T>(path: string, auth: boolean, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const sep = path.includes("?") ? "&" : "?";
    const res = await f(`${SIMKL_API}${path}${sep}client_id=${encodeURIComponent(clientId)}`, {
      method: init.method ?? "GET",
      headers: headers(auth),
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    if (res.status === 401 && auth) kv.set(TOKEN, null);
    if (!res.ok) throw new SimklError(res.status, `Simkl ${path.split("?")[0]} ${res.status}`);
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
  return {
    clientId,
    signedIn: () => Boolean(clientId && token()),
    setToken: (t) => kv.set(TOKEN, t),
    call: (path, init) => send(path, true, init),
    open: (path) => send(path, false),
  };
}
