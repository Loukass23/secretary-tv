// The TV's picture mode read and set on the TV itself (docs/smartthings.md, "Picture mode"). Samsung's
// `webapis.settings` answers for the item "picturemode" with what the TV's own menu shows ({ osdName: "Eco", value })
// and follows the remote within a second or two, where SmartThings' `samsungvd.pictureMode` never moves on the
// reference TV. Setting it takes the value of the mode's entry in the item's list. Each call is synchronous and costs
// about 16 ms on the TV, so it is read on load, when Secretary comes back to the screen and on each press, never per frame.

/** The part of Samsung's `webapis.settings` used here. */
export interface TvSettings {
  getItemValue(id: string): { osdName?: string; value?: number } | null;
  getItemDataList(id: string): { osdName?: string; value?: number }[] | null;
  setItemValue(id: string, value: string): boolean;
}

const ITEM = "picturemode";

/** `webapis.settings` when this TV has it. */
export function tvSettings(): TvSettings | null {
  const s = (globalThis as { webapis?: { settings?: Partial<TvSettings> } }).webapis?.settings;
  return s && typeof s.getItemValue === "function" && typeof s.setItemValue === "function" && typeof s.getItemDataList === "function" ? (s as TvSettings) : null;
}

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The picture mode the TV shows now, by its menu name; undefined without the API or when it refuses. */
export function readTvPicture(s: TvSettings | null = tvSettings()): string | undefined {
  if (!s) return undefined;
  try {
    const v = s.getItemValue(ITEM);
    return typeof v?.osdName === "string" && v.osdName ? v.osdName : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Sets the picture mode on the TV; true when the TV reads back the mode asked for. The list holds each name several
 * times, once per kind of source (the high 16 bits of the value: 65536 is the TV's own apps here), so the entry of the
 * current source's kind is the one set.
 */
export function setTvPicture(mode: string, s: TvSettings | null = tvSettings()): boolean {
  if (!s) return false;
  try {
    const now = s.getItemValue(ITEM);
    const list = s.getItemDataList(ITEM) ?? [];
    const kind = typeof now?.value === "number" ? Math.floor(now.value / 65536) : -1;
    const named = list.filter((e) => typeof e.osdName === "string" && key(e.osdName) === key(mode) && typeof e.value === "number");
    const hit = named.find((e) => Math.floor(e.value! / 65536) === kind) ?? named[0];
    if (!hit) return false;
    if (!s.setItemValue(ITEM, String(hit.value))) return false;
    return key(readTvPicture(s) ?? "") === key(mode);
  } catch {
    return false;
  }
}

/** What Secretary last set and when (epoch ms; 0 when stored before the time was kept). */
export interface PictureSet {
  mode: string;
  at: number;
}

/** What SmartThings reports and when the TV last changed it (epoch ms), when it reports it. */
export interface PictureReport {
  mode?: string;
  at?: number;
}

/**
 * The picture mode the TV is in, best guess first: the TV's own reading; without one, whichever of SmartThings' report
 * and Secretary's last set is newer (SmartThings' when only it has a time, Secretary's when only it is known).
 */
export function currentPicture(onDevice: string | undefined, last: PictureSet | undefined, st: PictureReport | undefined): string | undefined {
  if (onDevice) return onDevice;
  if (!last) return st?.mode;
  if (!st?.mode) return last.mode;
  return (st.at ?? 0) > last.at ? st.mode : last.mode;
}

/** `nest.pictureLast` as stored: JSON `{ mode, at }`, or the plain mode name of older builds. */
export function parsePictureSet(raw: string | null): PictureSet | undefined {
  if (!raw) return undefined;
  if (raw.startsWith("{")) {
    try {
      const v = JSON.parse(raw) as Partial<PictureSet>;
      return typeof v.mode === "string" && v.mode ? { mode: v.mode, at: typeof v.at === "number" ? v.at : 0 } : undefined;
    } catch {
      return undefined;
    }
  }
  return { mode: raw, at: 0 };
}
