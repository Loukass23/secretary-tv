// How many lights are on: one count for the Home card ("3 lights on") and the Lights panel ("3 of 11 on"), so the two
// never disagree. Only SmartThings devices of kind "light" count: the panel also lists the sound system with them, but
// it is not a light, and a TV or a sensor never counts.
import type { StDevice } from "@secretary/smartthings";

export interface LightCount {
  on: number;
  total: number;
}

/**
 * The lights that are on, out of all of them. `pending` holds switches made from the panel that no poll has confirmed
 * yet (by device id), so the count follows the remote at once.
 */
export function lightCount(devices: readonly Pick<StDevice, "id" | "kind" | "on">[], pending: Readonly<Record<string, boolean>> = {}): LightCount {
  let on = 0;
  let total = 0;
  for (const d of devices) {
    if (d.kind !== "light") continue;
    total++;
    if (pending[d.id] ?? d.on === true) on++;
  }
  return { on, total };
}

/** "1 light on", "3 lights on", "No lights on". */
export function lightsOnLabel({ on }: LightCount): string {
  if (on === 0) return "No lights on";
  return `${on} light${on === 1 ? "" : "s"} on`;
}
