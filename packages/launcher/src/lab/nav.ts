// Content and remote navigation for the glass lab, kept apart from the view so it can be tested.
export const SEGMENTS = ["List", "Day", "Week", "Month"];
export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Mon"];
export const HOURS = [
  ["🌧", "23°", "noon"],
  ["🌧", "23°", "1pm"],
  ["⛅", "23°", "2pm"],
  ["⛅", "23°", "NOW"],
  ["⛅", "21°", "4pm"],
  ["☁", "22°", "5pm"],
  ["💨", "20°", "6pm"],
];
export const EVENTS = [
  ["Movie night: Dune Part Two", "Living room · Secretary Cinema", "8:00pm", "#5b7cff"],
  ["Meeting business partner", "Don't forget to bring laptop…", "3:45pm", "#3ccf6e"],
  ["Complete concept projects", "Pay more attention to new ways…", "5:30pm", "#f5b83d"],
  ["Family meeting", "Do some different things.", "7:45pm", "#e0566b"],
  ["Prepare portfolio", "Use the new template", "9:00pm", "#7d6bff"],
  ["New episode: Severance", "Secretary Shows", "10:00pm", "#ff5a26"],
  ["Water the plants", "SmartThings reminder", "10:30pm", "#3ccf6e"],
  ["Lights off", "Scene: Night", "11:00pm", "#5b7cff"],
  ["Back up photos", "Story · March 23", "11:30pm", "#f5b83d"],
  ["Sleep", "Alarm 7:00am", "11:45pm", "#9c9b97"],
];

export const ICONS = ["⌕", "🔔"];

export type Area = "top" | "dates" | "cards" | "weather" | "tiles";
const LENGTH: Record<Area, number> = {
  top: SEGMENTS.length + ICONS.length,
  dates: DAYS.length,
  cards: EVENTS.length,
  weather: HOURS.length,
  tiles: 2,
};

export interface Focus {
  area: Area;
  i: number;
}

/** Remote navigation between the lab's areas: the key path `cdp.mjs walk` drives. */
export function step(at: Focus, key: string): Focus {
  const { area, i } = at;
  const last = LENGTH[area] - 1;
  const go = (a: Area, n: number): Focus => ({ area: a, i: Math.max(0, Math.min(LENGTH[a] - 1, n)) });
  switch (area) {
    case "top":
      if (key === "Left") return go("top", i - 1);
      if (key === "Right") return go("top", i + 1);
      // The segments sit above the weather row, the icon buttons above the date strip.
      if (key === "Down") return go(i < SEGMENTS.length ? "weather" : "dates", 3);
      return at;
    case "dates":
      if (key === "Left") return go("dates", i - 1);
      if (key === "Right") return go("dates", i + 1);
      if (key === "Up") return go("top", SEGMENTS.length);
      if (key === "Down") return go("cards", 0);
      return at;
    case "cards":
      if (key === "Up") return i === 0 ? go("dates", 3) : go("cards", i - 1);
      if (key === "Down") return go("cards", i + 1);
      if (key === "Left") return go("weather", 3);
      return at;
    case "weather":
      if (key === "Left") return go("weather", i - 1);
      if (key === "Right") return i === last ? go("cards", 0) : go("weather", i + 1);
      if (key === "Up") return go("top", 0);
      if (key === "Down") return go("tiles", 0);
      return at;
    case "tiles":
      if (key === "Left") return go("tiles", i - 1);
      if (key === "Right") return i === last ? go("cards", 0) : go("tiles", i + 1);
      if (key === "Up") return go("weather", 3);
      return at;
  }
}
