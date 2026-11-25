// The one header of Secretary, on every screen and panel (home, catalog home, title pages, search, Settings, Lights,
// Watch together): the person at the left, the quiet buttons in their one order, then the clock last, at the right edge.
// On title pages it collapses: the person and the buttons fade out and the clock stays exactly where it is, so the
// artwork stays clear; Up on the remote brings the buttons back. The host screen owns `expanded` and the focus, as with
// every glass control: the header only draws them.
//
// Collapsing moves nothing: the person and the buttons fade as one layer (opacity), so it costs a compositor animation
// and no layout or paint.
import type { ComponentChildren } from "preact";
import { Avatar, Icon, IconButton } from "./controls.tsx";
import type { IconName } from "./icons.ts";

/** Where the header sits on the 1920x1080 page; `bottom` is the first free line under it. */
export const HEADER = { pad: 80, y: 44, h: 78, bottom: 122 } as const;
/** One header button; the gap is between two buttons, `clockGap` between the last button and the clock. */
export const HEADER_BUTTON = { w: 88, h: 78, gap: 28, clockGap: 24 } as const;
/** The clock's box at the right edge: wide enough for "12:59 PM" at the Large text size; the time is right-aligned in it. */
export const HEADER_CLOCK = { w: 200 } as const;
/** Where the last button ends: left of the clock. */
const BUTTONS_RIGHT = 1920 - HEADER.pad - HEADER_CLOCK.w - HEADER_BUTTON.clockGap;

export interface HeaderButton {
  /** Stable key, for Preact; the host maps its own focus indexes onto the button order. */
  key: string;
  icon: IconName;
  /** true draws the small bar, a number the count bubble (nothing for 0), both in the accent. */
  badge?: boolean | number;
}

export interface HeaderPerson {
  name: string;
  /** A line under the name: words, or a few icons. */
  sub?: ComponentChildren;
  color?: string;
  img?: string;
}

export interface HeaderProps {
  /** The clock's text, e.g. "20:41". Always shown, last at the right edge. */
  time: string;
  /** true: person, buttons and clock. false: the clock alone, in the same place. Default true. */
  expanded?: boolean;
  /** Top left. Without it the left of the header is empty. */
  person?: HeaderPerson;
  /** Left to right; the last one sits just left of the clock. */
  buttons: readonly HeaderButton[];
  /** What has the remote: "person", a button's index in `buttons`, or null for nothing in the header. */
  focus?: "person" | number | null;
}

/** The x of button `k` of `n`, so a host can place a menu or a glow under it. */
export const headerButtonX = (k: number, n: number): number =>
  BUTTONS_RIGHT - n * HEADER_BUTTON.w - (n - 1) * HEADER_BUTTON.gap + k * (HEADER_BUTTON.w + HEADER_BUTTON.gap);

export function Header({ time, expanded = true, person, buttons, focus = null }: HeaderProps) {
  const n = buttons.length;
  return (
    <>
      <div class={`sg-head-items${expanded ? "" : " is-away"}`}>
        {person && (
          <Avatar x={HEADER.pad} y={HEADER.y} name={person.name} sub={person.sub} color={person.color} img={person.img} focused={expanded && focus === "person"} />
        )}
        {buttons.map((b, k) => (
          <IconButton
            key={b.key}
            x={headerButtonX(k, n)}
            y={HEADER.y}
            w={HEADER_BUTTON.w}
            h={HEADER_BUTTON.h}
            frost={false}
            class="sg-quiet"
            icon={<Icon name={b.icon} />}
            badge={b.badge}
            focused={expanded && focus === k}
          />
        ))}
      </div>
      <div class="sg-head-clock" style={{ right: `${HEADER.pad}px`, top: `${HEADER.y}px`, width: `${HEADER_CLOCK.w}px` }}>
        <b>{time}</b>
      </div>
    </>
  );
}
