// Remote navigation for the Nest home screen (docs/launcher.md). Pure so it can be tested.
//
//   weather   the weather and clock, top left (OK opens the forecast)
//   top       section pill (4) + Watch together + Search + Lights + Bell, across the top
//   apps      the app strip, top right
//   cards     reminders, right column
//   ask       the Ask Nest chips, under the wave (left)
//   results   what the assistant found, in place of the right column while shown
//   continue  Recent: the assistant's latest answers, then Continue Watching, bottom left
//   fab       the add-reminder button, bottom right
//   me        the account avatar, bottom left (Nuvio sign-in and profiles)
export type Area = "weather" | "top" | "apps" | "cards" | "ask" | "results" | "continue" | "fab" | "me";

export interface Focus {
  area: Area;
  i: number;
}

export type Lengths = Record<Area, number>;

export const SECTIONS = ["Nest", "Cinema", "Shows", "Anime"] as const;
export const TOP_PARTY = SECTIONS.length;
export const TOP_SEARCH = SECTIONS.length + 1;
export const TOP_LIGHTS = SECTIONS.length + 2;
export const TOP_BELL = SECTIONS.length + 3;
export const TOP_LENGTH = SECTIONS.length + 4;

/** Moves to the first area in `order` that has items; stays put when none has. */
function first(len: Lengths, at: Focus, order: readonly (readonly [Area, number])[]): Focus {
  for (const [area, i] of order) {
    if (len[area] > 0) return { area, i: Math.max(0, Math.min(len[area] - 1, i)) };
  }
  return at;
}

export function step(at: Focus, key: string, len: Lengths): Focus {
  const { area, i } = at;
  const last = len[area] - 1;
  const along = (d: number): Focus => (i + d < 0 || i + d > last ? at : { area, i: i + d });
  switch (area) {
    case "weather":
      if (key === "Right") return first(len, at, [["top", 0]]);
      if (key === "Down") return first(len, at, [["ask", 0], ["continue", 0], ["me", 0]]);
      return at;
    case "top":
      if (key === "Left") return i > 0 ? along(-1) : first(len, at, [["weather", 0]]);
      if (key === "Right") return along(1);
      // The pill sits over the left column, the buttons over the right one.
      if (key === "Down" && i < TOP_PARTY) return first(len, at, [["ask", 0], ["continue", 0], ["results", 0], ["apps", 0], ["cards", 0]]);
      if (key === "Down") return first(len, at, [["results", 0], ["apps", 0], ["cards", 0], ["ask", 0], ["continue", 0]]);
      return at;
    case "apps":
      if (key === "Left") return along(-1);
      if (key === "Right") return along(1);
      if (key === "Up") return first(len, at, [["top", TOP_SEARCH]]);
      if (key === "Down") return first(len, at, [["cards", 0], ["fab", 0]]);
      return at;
    case "cards":
      if (key === "Up") return i > 0 ? along(-1) : first(len, at, [["apps", 0], ["top", TOP_SEARCH]]);
      if (key === "Down") return i < last ? along(1) : first(len, at, [["fab", 0]]);
      if (key === "Left") return first(len, at, [["continue", 0], ["ask", 0]]);
      return at;
    case "ask":
      if (key === "Left") return along(-1);
      if (key === "Right") return i < last ? along(1) : first(len, at, [["results", 0], ["cards", 0], ["apps", 0]]);
      if (key === "Up") return first(len, at, [["weather", 0], ["top", 0]]);
      if (key === "Down") return first(len, at, [["continue", 0], ["me", 0]]);
      return at;
    case "results":
      if (key === "Left") return i > 0 ? along(-1) : first(len, at, [["ask", len.ask - 1], ["continue", 0]]);
      if (key === "Right") return along(1);
      if (key === "Up") return first(len, at, [["top", TOP_SEARCH]]);
      if (key === "Down") return first(len, at, [["fab", 0], ["continue", 0]]);
      return at;
    case "continue":
      if (key === "Left") return along(-1);
      if (key === "Right") return i < last ? along(1) : first(len, at, [["results", 0], ["cards", 0], ["apps", 0]]);
      if (key === "Up") return first(len, at, [["ask", 0], ["top", 0]]);
      if (key === "Down") return first(len, at, [["me", 0]]);
      return at;
    case "fab":
      if (key === "Up") return first(len, at, [["cards", len.cards - 1], ["results", 0], ["apps", 0]]);
      if (key === "Left") return first(len, at, [["continue", len.continue - 1], ["me", 0]]);
      return at;
    case "me":
      if (key === "Up") return first(len, at, [["continue", 0], ["ask", 0], ["top", 0]]);
      if (key === "Right") return first(len, at, [["fab", 0]]);
      return at;
  }
}

/** Keeps focus valid when an area shrinks or empties (reminders done, nothing in progress, results closed). */
export function clamp(at: Focus, len: Lengths): Focus {
  if (len[at.area] > at.i) return at;
  if (len[at.area] > 0) return { area: at.area, i: len[at.area] - 1 };
  return first(len, at, [["apps", 0], ["cards", 0], ["ask", 0], ["continue", 0], ["me", 0], ["top", 0]]);
}
