// The slice of the Cloudflare Workers runtime this package uses, typed here so the repo needs no workers-types.

export interface WsLike {
  accept(): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "message", cb: (e: { data: unknown }) => void): void;
  addEventListener(type: "close" | "error", cb: () => void): void;
}

export interface StorageLike {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  deleteAll(): Promise<void>;
  setAlarm(at: number): Promise<void>;
  deleteAlarm(): Promise<void>;
}

export interface DurableObjectStateLike {
  storage: StorageLike;
}

export interface DurableObjectStubLike {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}

export interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStubLike;
}

/** The Workers rate limiting binding. */
export interface RateLimiterLike {
  limit(o: { key: string }): Promise<{ success: boolean }>;
}

/** `new WebSocketPair()`: [client, server]. Workers only. */
export function webSocketPair(): [WsLike, WsLike] {
  const Pair = (globalThis as unknown as { WebSocketPair: new () => Record<0 | 1, WsLike> }).WebSocketPair;
  const p = new Pair();
  return [p[0], p[1]];
}

/** The 101 response that hands `client` to the caller. Workers only. */
export const upgraded = (client: WsLike) => new Response(null, { status: 101, webSocket: client } as ResponseInit);

/**
 * Accepts the upgrade only to close it with a reason: a TV WebSocket cannot read the HTTP status of a refused
 * handshake, but it does get the close code.
 */
export function refuseSocket(code: number, reason: string): Response {
  const [client, server] = webSocketPair();
  server.accept();
  server.close(code, reason);
  return upgraded(client);
}
