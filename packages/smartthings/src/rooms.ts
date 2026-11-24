// Devices grouped by their SmartThings room, as the lights panel lists them. Pure: the rooms come from `roomsIn`.
import type { StDevice, StRoom } from "./api.ts";

export interface RoomGroup {
  /** The room's id; null for the devices in no room (or in a room SmartThings did not list). */
  id: string | null;
  name: string;
  devices: StDevice[];
}

/** What the last group is called. */
export const NO_ROOM = "No room";

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });

/**
 * One group per room that holds any of `devices`, rooms by name and devices by name within each, then the devices with
 * no known room last. Rooms with nothing in them are left out; two rooms of the same name (in two homes) stay apart.
 */
export function groupByRoom(devices: readonly StDevice[], rooms: readonly StRoom[]): RoomGroup[] {
  const known = new Map(rooms.map((r) => [r.id, r]));
  const groups = new Map<string, RoomGroup>();
  const loose: StDevice[] = [];
  for (const d of devices) {
    const room = d.roomId ? known.get(d.roomId) : undefined;
    if (!room) {
      loose.push(d);
      continue;
    }
    let g = groups.get(room.id);
    if (!g) groups.set(room.id, (g = { id: room.id, name: room.name || "Room", devices: [] }));
    g.devices.push(d);
  }
  const out = [...groups.values()].sort(byName);
  if (loose.length) out.push({ id: null, name: NO_ROOM, devices: loose });
  for (const g of out) g.devices.sort(byName);
  return out;
}
