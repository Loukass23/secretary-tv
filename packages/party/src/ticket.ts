// Join tickets: short-lived, HMAC-signed, carried in the WebSocket URL because a Tizen WebSocket cannot set headers.
import { b64urlToBytes, bytesToB64url } from "./auth.ts";
import type { Identity } from "./room.ts";

export interface Ticket {
  /** Room code. */
  room: string;
  member: Identity;
  /** Server ms after which the ticket no longer opens a socket. */
  exp: number;
  /** Random id; the room refuses a second use. */
  id: string;
}

export const TICKET_TTL_MS = 60_000;

const enc = new TextEncoder();

const hmacKey = (secret: string) =>
  crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

export async function signTicket(secret: string, t: Omit<Ticket, "id"> & { id?: string }): Promise<string> {
  const body: Ticket = { ...t, id: t.id ?? bytesToB64url(crypto.getRandomValues(new Uint8Array(12))) };
  const payload = bytesToB64url(enc.encode(JSON.stringify(body)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(payload));
  return `${payload}.${bytesToB64url(sig)}`;
}

/** The ticket when its signature holds, it is for this room and it has not expired; otherwise null. */
export async function verifyTicket(secret: string, token: string, room: string, now: number): Promise<Ticket | null> {
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), b64urlToBytes(sig), enc.encode(payload));
    if (!ok) return null;
    const t = JSON.parse(new TextDecoder().decode(b64urlToBytes(payload))) as Ticket;
    if (t.room !== room || typeof t.exp !== "number" || t.exp <= now || typeof t.id !== "string") return null;
    if (typeof t.member?.id !== "string") return null;
    return t;
  } catch {
    return null;
  }
}
