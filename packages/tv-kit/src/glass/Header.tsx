// The one header of Secretary: the person top left, the clock and the quiet buttons top right. On the home screen and
// opened cards it is always expanded; on title pages it collapses to the clock alone, top right, so the artwork stays
// clear, and Up on the remote expands it again. The host screen owns `expanded` and the focus, as with every glass
// control: the header only draws them.
//
// Collapsing moves nothing but the clock (transform, on its own layer) and fades the person and the buttons out as one
// layer (opacity), so it costs a compositor animation and no layout or paint.
import type { ComponentChildren } from "preact";
import { Avatar, Icon, IconButton } from "./controls.tsx";
import type { IconName } from "./icons.ts";

/** Where the header sits on the 1920x1080 page; `bottom` is the first free line under it. */
export const HEADER = { pad: 80, y: 44, h: 78, bottom: 122 } as const;
/** One header button; the gap is between two buttons, `clockGap` between the clock and the first button. */
export const HEADER_BUTTON = { w: 88, h: 78, gap: 28, clockGap: 48 } as const;

export interface HeaderButton {
  /** Stable key, for Preact; the host maps its own focus indexes onto the button order. */
  key: string;
  icon: IconName;
  /** true draws the small bar, a number the red count bubble (nothing for 0). */
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
  /** The clock's text, e.g. "20:41". Always shown. */
  time: string;
  /** true: person, clock and buttons. false: the clock alone, top right. Default true. */
  expanded?: boolean;
  /** Top left. Without it the left of the header is empty. */
  person?: HeaderPerson;
  /** Right to left from the edge, the last one nearest the edge. */
  buttons: readonly HeaderButton[];
  /** What has the remote: "person", a button's index in `buttons`, or null for nothing in the header. */
  focus?: "person" | number | null;
}

/** The x of button `k` of `n`, so a host can place a menu or a glow under it. */
export const headerButtonX = (k: number, n: number): number =>
  1920 - HEADER.pad - n * HEADER_BUTTON.w - (n - 1) * HEADER_BUTTON.gap + k * (HEADER_BUTTON.w + HEADER_BUTTON.gap);

export function Header({ time, expanded = true, person, buttons, focus = null }: HeaderProps) {
  const n = buttons.length;
  // Expanded, the clock sits left of the buttons; collapsed, it slides to the right edge.
  const shift = n ? n * HEADER_BUTTON.w + (n - 1) * HEADER_BUTTON.gap + HEADER_BUTTON.clockGap : 0;
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
      <div
        class="sg-head-clock"
        style={{ right: `${HEADER.pad}px`, top: `${HEADER.y}px`, transform: `translate3d(${expanded ? -shift : 0}px,0,0)` }}
      >
        <b>{time}</b>
      </div>
    </>
  );
}
