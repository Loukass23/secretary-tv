// The mood strip: OK on the header's lights button opens a small row of icons under it, one per mood (moods.ts), then
// "more" for the full Mood panel. One press on an icon sets that mood. The active mood carries the small bar, and the
// line under the icons names the focused one. It is drawn on the page under the header, the icons as their own
// surfaces beside one frosted panel (no glass inside glass), focus by the glass's own sheet (opacity).
import { Glass, HEADER, headerButtonX, HEADER_BUTTON, Icon, IconButton, type IconName } from "@secretary/tv-kit/src/glass/index.ts";
import { HEADER_ORDER } from "./home.tsx";
import { HEADER_LIGHTS } from "./nest-nav.ts";

export interface MoodStripView {
  moods: readonly { key: string; icon: IconName; label: string; hint: string }[];
  /** The key of the mood last set, or null. */
  active: string | null;
  /** The focused stop: a mood, or `moods.length` for "more". */
  at: number;
}

const PAD = 14;
const GAP = 14;
/** The two lines under the icons: the focused mood's name, then its hint. */
const LINE = 88;
/** Wide enough for a hint on one line, even with the four moods alone. */
const MIN_W = 640;
export const STRIP_ITEM = { w: HEADER_BUTTON.w, h: HEADER_BUTTON.h } as const;

/** Where the strip sits: centred under the lights button, kept on the screen. */
export function stripBox(stops: number, buttons = HEADER_ORDER.length): { x: number; y: number; w: number; h: number } {
  const w = Math.max(MIN_W, PAD * 2 + stops * STRIP_ITEM.w + (stops - 1) * GAP);
  const k = HEADER_ORDER.indexOf(HEADER_LIGHTS);
  const centre = headerButtonX(Math.max(0, k), buttons) + HEADER_BUTTON.w / 2;
  const x = Math.round(Math.max(80, Math.min(1920 - 80 - w, centre - w / 2)));
  return { x, y: HEADER.bottom + 14, w, h: PAD * 2 + STRIP_ITEM.h + LINE };
}

export function MoodStrip({ moods, active, at }: MoodStripView) {
  const stops = moods.length + 1;
  const box = stripBox(stops);
  const focused = moods[at];
  return (
    <>
      <Glass {...box} class="nest-moodstrip" />
      {moods.map((m, i) => (
        <IconButton
          key={m.key}
          x={box.x + PAD + i * (STRIP_ITEM.w + GAP)}
          y={box.y + PAD}
          {...STRIP_ITEM}
          frost={false}
          class="sg-quiet"
          icon={<Icon name={m.icon} />}
          badge={m.key === active}
          focused={at === i}
        />
      ))}
      <IconButton
        key="more"
        x={box.x + PAD + moods.length * (STRIP_ITEM.w + GAP)}
        y={box.y + PAD}
        {...STRIP_ITEM}
        frost={false}
        class="sg-quiet"
        icon={<Icon name="more" />}
        focused={at === moods.length}
      />
      <div class="nest-moodstrip-line" style={{ left: `${box.x + PAD + 8}px`, top: `${box.y + PAD + STRIP_ITEM.h + 12}px`, width: `${box.w - PAD * 2 - 16}px` }}>
        <b>{focused ? focused.label : "Mood"}</b>
        <small>{focused ? (focused.key === active ? "Active" : focused.hint) : "Every mood and what it does"}</small>
      </div>
    </>
  );
}
