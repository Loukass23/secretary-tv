// One Durable Object per room code: owns the sockets, feeds the pure Room, sends what it says, persists it and keeps
// one alarm at its next deadline. Reachable only through the Worker, which has already checked the caller.
import { Close } from "./protocol.ts";
import { Room, type Out, type RoomInit, type RoomSnapshot } from "./room.ts";
import type { Ticket } from "./ticket.ts";
import { upgraded, webSocketPair, type DurableObjectStateLike, type WsLike } from "./cf.ts";

/** Internal header the Worker uses to pass a verified ticket to the room. */
export const TICKET_HEADER = "X-Party-Ticket";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export class PartyRoom {
  private readonly state: DurableObjectStateLike;
  private readonly now: () => number;
  private room: Room | undefined;
  private loaded = false;
  private readonly sockets = new Map<string, WsLike>();

  constructor(state: DurableObjectStateLike, _env?: unknown, now: () => number = Date.now) {
    this.state = state;
    this.now = now;
  }

  async fetch(req: Request): Promise<Response> {
    const room = await this.load();
    const path = new URL(req.url).pathname;
    if (path === "/create" && req.method === "POST") {
      if (room) return json(409, { error: "code taken" });
      const init = (await req.json()) as RoomInit;
      this.room = Room.create(init, this.now);
      await this.flush(true);
      return json(201, this.room.summary());
    }
    if (path === "/summary") return room ? json(200, room.summary()) : json(404, { error: "no such room" });
    if (path === "/connect") return this.connect(req, room);
    return json(404, { error: "not found" });
  }

  async alarm(): Promise<void> {
    const room = await this.load();
    if (!room) return;
    room.tick();
    await this.flush(true);
  }

  private async load(): Promise<Room | undefined> {
    if (!this.loaded) {
      this.loaded = true;
      const snap = await this.state.storage.get<RoomSnapshot>("room");
      if (snap) {
        this.room = new Room(snap, this.now);
        // Sockets do not survive the object being evicted or restarted: everyone reconnects with a new ticket.
        for (const m of this.room.members()) if (m.connected) this.room.leave(m.id);
        this.room.drain();
      }
    }
    return this.room;
  }

  private async connect(req: Request, room: Room | undefined): Promise<Response> {
    const ticket = JSON.parse(req.headers.get(TICKET_HEADER) ?? "null") as Ticket | null;
    const [client, server] = webSocketPair();
    server.accept();
    if (!room || !ticket) {
      server.close(Close.NotFound, "no such room");
      return upgraded(client);
    }
    const res = room.join(ticket.member, { id: ticket.id, exp: ticket.exp });
    if (!res.ok) {
      server.close(res.code, res.reason);
      return upgraded(client);
    }
    const id = ticket.member.id;
    const old = this.sockets.get(id);
    this.sockets.set(id, server);
    old?.close(Close.Replaced, "connected elsewhere");

    // Events from a socket that has since been replaced are ignored, or its close would drop the new connection.
    server.addEventListener("message", (e) => {
      if (this.sockets.get(id) !== server) return;
      room.receive(id, typeof e.data === "string" ? e.data : "");
      void this.flush();
    });
    const gone = () => {
      if (this.sockets.get(id) !== server) return;
      this.sockets.delete(id);
      room.leave(id);
      void this.flush();
    };
    server.addEventListener("close", gone);
    server.addEventListener("error", gone);
    await this.flush(true);
    return upgraded(client);
  }

  /**
   * Sends and closes what the room produced, then persists. Pings and reactions alone do not write storage; the
   * alarm and every timeline or member change do.
   */
  private async flush(force = false): Promise<void> {
    const room = this.room;
    if (!room) return;
    const out = room.drain();
    let changed = force;
    for (const o of out) {
      changed ||= isChange(o);
      if ("close" in o) {
        const ws = this.sockets.get(o.close);
        this.sockets.delete(o.close);
        ws?.close(o.code, o.reason);
        continue;
      }
      const data = JSON.stringify(o.msg);
      if ("all" in o) for (const ws of this.sockets.values()) trySend(ws, data);
      else {
        const ws = this.sockets.get(o.to);
        if (ws) trySend(ws, data);
      }
    }
    const storage = this.state.storage;
    if (room.finished) {
      for (const ws of this.sockets.values()) ws.close(Close.Expired, "room closed");
      this.sockets.clear();
      this.room = undefined;
      await storage.deleteAlarm();
      await storage.deleteAll();
      return;
    }
    if (!changed) return;
    await storage.put("room", room.snapshot());
    const wake = room.nextWake();
    if (wake !== undefined) await storage.setAlarm(wake);
  }
}

const isChange = (o: Out) => "close" in o || (o.msg.t !== "pong" && o.msg.t !== "react" && o.msg.t !== "error");

function trySend(ws: WsLike, data: string) {
  try {
    ws.send(data);
  } catch {
    // The close event follows and removes the member.
  }
}
