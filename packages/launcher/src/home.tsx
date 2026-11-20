// The Nest home screen (docs/launcher.md): the person top left, a small clock and quiet buttons top right, and one row of
// content cards, the Assistant first, then the weather over the calendar, Recent and one per app, running off the right
// edge. The assistant also sits under the cards (the compact mode, with its line and one line of text), or takes the
// whole screen (the chat, opened from its card). Layout only; data and keys live in app.tsx.
import { useRef } from "preact/hooks";
import { Avatar, Glass, Glow, Icon, IconButton, type IconName, Scroller, VoiceWave, type WaveState } from "@secretary/tv-kit/src/glass/index.ts";
import { type CardStyle, LAYOUT_LABEL, LAYOUTS, REMOVE_LINE, SIZE_LABEL, SIZE_LINE, type StyleMenu } from "./card-style.ts";
import { CARD_H, columnShape, expands, itemBox, LABEL_H, RowCard, type RowColumn, rowLayout } from "./cards.tsx";
import { type Focus, HEADER_BELL, HEADER_LIGHTS, HEADER_PARTY, HEADER_PICTURE, HEADER_PROFILE, HEADER_SEARCH } from "./nest-nav.ts";

const PAD = 80;
const HEAD_Y = 44;
/** Party, Search, Lights, Picture and Bell, right to left from the edge. */
const ICON = { w: 88, h: 78, gap: 28 };
const ICON_COUNT = 5;
const ICONS_X = 1920 - PAD - ICON_COUNT * ICON.w - (ICON_COUNT - 1) * ICON.gap;

/** The picture button shows the mode the TV is on: a sun for Dynamic, a moon for Eco, a screen for anything else. */
function pictureIcon(mode: string | undefined): IconName {
  const m = (mode ?? "").toLowerCase();
  return m.startsWith("dynamic") ? "clear" : m.startsWith("eco") ? "clear-night" : "partly";
}
/** The full screen width: the orb rests in the middle under the cards, and the ribbons run out to both edges. */
const WAVE = { x: 0, y: 880, w: 1920, h: 72 };
/** The cards start at the left edge, the assistant being the first of them. The row clips sideways; it is tall enough for
 * an opened card's caption and synopsis under its titles. */
const ROW = { x: PAD, y: 236, h: LABEL_H + CARD_H + 240 };
/** The right edge a focused card is kept inside of. */
const VIEW_RIGHT = 1920 - 60;
const MENU = { x: PAD, y: 150, w: 480, item: 76 };
/** The assistant's two modes: under the cards (compact) and on the whole screen (full). */
export interface AskView {
  wave: WaveState;
  /** "Listening…", "Thinking…", or empty. */
  status: string;
  prompt?: string;
  reply: string;
  /** Changes with each new answer, so the text fades in again. */
  turnId: number;
  /** Compact: the assistant under the cards has focus, so its line is drawn out and its text shown. */
  focused: boolean;
  /** Full: the cards defocus and the assistant takes the screen. */
  full: boolean;
}

interface Props {
  focus: Focus | null;
  time: string;
  ask: AskView;
  /** The profile menu's items while it is open. */
  menu: readonly string[] | null;
  /** Lines over the menu's items: what the TV is connected to, in words. */
  menuInfo?: readonly string[];
  /** What the TV is connected to, as icons under the person's name; an alert dot on one that is off. */
  links?: readonly { icon: IconName; off?: boolean }[];
  /** The glow image in the focused picture's artwork colour. */
  glow?: string;
  columns: readonly RowColumn[];
  /** Open reminders, for the bell's count. */
  open: number;
  status: string;
  /** The Nuvio profile on this TV; null without Nuvio. */
  me: { name: string; color?: string; img?: string } | null;
  /** The card style menu (a long OK on a media card), while it is open. */
  styleMenu?: StyleMenu | null;
  /** The remove menu (a long OK on any other card), while it is open: the card's key. */
  removeMenu?: string | null;
  /** The TV's picture mode, when SmartThings reports it; the Picture button's icon follows it. */
  pictureMode?: string;
}

const INFO_H = 36;
/** Where the profile menu's items start: under its lines of connection details and a hairline. */
const menuTop = (info: readonly string[]) => (info.length ? 22 + info.length * INFO_H + 20 : 12);

/** What the TV is connected to, as quiet icons; one that is off carries the alert dot. */
function Links({ links }: { links: readonly { icon: IconName; off?: boolean }[] }) {
  return (
    <span class="nest-links">
      {links.map((l) => (
        <span key={l.icon} class="nest-link">
          <Icon name={l.icon} />
          {l.off && <b class="nest-link-off" />}
        </span>
      ))}
    </span>
  );
}

const STYLE_W = 460;
const STYLE_LINE = 72;

/** The long-OK menu beside a media card: its layouts, then its size. The card shows each choice as it is picked. */
function CardStyleMenu({ m, x, y, name }: { m: StyleMenu; x: number; y: number; name: string }) {
  const lines = [...LAYOUTS.map((l) => LAYOUT_LABEL[l]), `Size  ‹ ${SIZE_LABEL[m.style.size]} ›`, "Remove from home"];
  return (
    <Glass x={x} y={y} w={STYLE_W} h={96 + lines.length * STYLE_LINE + 64} class="nest-menu nest-style">
      <span class="nest-kicker nest-style-head">{name} · card style</span>
      {lines.map((label, i) => (
        <span
          key={i}
          class={`nest-menu-item${m.line === i ? " is-focus" : ""}${i < SIZE_LINE && LAYOUTS[i] === m.style.layout ? " is-picked" : ""}`}
          style={{ top: `${76 + i * STYLE_LINE}px` }}
        >
          {label}
        </span>
      ))}
      <small class="nest-style-hint" style={{ top: `${88 + lines.length * STYLE_LINE}px` }}>
        {m.line === REMOVE_LINE ? "OK removes · Back keeps" : "OK keeps · Back undoes"}
      </small>
    </Glass>
  );
}

/** The long-OK menu on the other cards: the one choice, taking the card off the home screen. */
function RemoveMenu({ x, y, name }: { x: number; y: number; name: string }) {
  return (
    <Glass x={x} y={y} w={STYLE_W} h={96 + STYLE_LINE + 64} class="nest-menu nest-style">
      <span class="nest-kicker nest-style-head">{name}</span>
      <span class="nest-menu-item is-focus" style={{ top: "76px" }}>
        Remove from home
      </span>
      <small class="nest-style-hint" style={{ top: `${88 + STYLE_LINE}px` }}>
        OK removes · Back keeps
      </small>
    </Glass>
  );
}

/** The style a card shows: the menu's while it is open on that card. */
export const shownStyle = (m: StyleMenu | null | undefined, key: string, saved: CardStyle): CardStyle => (m?.key === key ? m.style : saved);

export function Home({ focus, time, ask, menu, menuInfo = [], links = [], glow, columns, open, status, me, styleMenu, removeMenu, pictureMode }: Props) {
  const on = (area: Focus["area"], i: number) => focus?.area === area && focus.i === i;

  // A media card is open while the remote is inside it; the row scrolls just enough to keep the focused column whole.
  const openCol = focus?.area === "row" && focus.inside && expands(columns[focus.col ?? 0]) ? (focus.col ?? 0) : -1;
  const layout = rowLayout(columns, openCol);
  // The row keeps its scroll while the assistant or the header has focus, so it is where it was left when focus returns.
  const lastCol = useRef(0);
  if (focus?.area === "row") lastCol.current = focus.col ?? 0;
  const colAt = Math.min(lastCol.current, Math.max(0, columns.length - 1));
  const left = ROW.x + (layout.x[colAt] ?? 0);
  const rowScroll = Math.max(0, Math.min(left - PAD, left + (layout.w[colAt] ?? 0) - VIEW_RIGHT));
  const inside = focus?.area === "row" && focus.inside;
  const focusBox = inside && columns[colAt] && focus.i >= 0 ? itemBox(columns[colAt], focus.i, colAt === openCol) : null;
  const glowAt = focusBox
    ? { x: ROW.x + layout.x[colAt] - rowScroll + focusBox.x, y: ROW.y + LABEL_H + focusBox.y, w: focusBox.w, h: focusBox.h }
    : null;
  const menuKey = styleMenu?.key ?? removeMenu ?? null;
  // The wave shows only while someone speaks; the line under it says what is going on, or hints at what to do.
  const busy = ask.wave !== "idle";
  const live = busy || ask.focused;
  const line = busy ? ask.status || ask.reply : ask.focused ? "Press OK to talk" : "Ask Assistant";

  return (
    <>
      <Avatar x={PAD} y={HEAD_Y} name={me?.name ?? "Secretary Nest"} sub={status || <Links links={links} />} color={me?.color} img={me?.img} focused={on("header", HEADER_PROFILE)} />

      {/* Top right, quiet: a small clock, then the buttons. The date and the weather are cards now. */}
      <div class="nest-head" style={{ right: `${1920 - ICONS_X + 48}px`, top: `${HEAD_Y}px` }}>
        <div class="nest-time">
          <b>{time}</b>
        </div>
      </div>
      {(["party", "search", "lights", pictureIcon(pictureMode), "bell"] as const satisfies readonly IconName[]).map((icon, k) => (
        <IconButton
          key={k}
          x={ICONS_X + k * (ICON.w + ICON.gap)}
          y={HEAD_Y}
          w={ICON.w}
          h={ICON.h}
          class="nest-quiet"
          icon={<Icon name={icon} />}
          badge={k === 4 ? open : undefined}
          focused={on("header", [HEADER_PARTY, HEADER_SEARCH, HEADER_LIGHTS, HEADER_PICTURE, HEADER_BELL][k])}
        />
      ))}

      <Glow at={glowAt} src={glow} />

      {/* In the full chat the cards stay put but defocus (dimmed, blurred) behind the line. */}
      <div class={`nest-stage${ask.full ? " is-away" : ""}`}>
        <Scroller x={0} y={ROW.y} w={1920} h={ROW.h} axis="x" offset={rowScroll}>
          {columns.map((col, c) => (
            <RowCard
              key={col.key}
              col={col}
              x={ROW.x + layout.x[c]}
              page={[ROW.x + layout.x[c] - rowScroll, ROW.y + LABEL_H]}
              picked={focus?.area === "row" && !inside && colAt === c}
              focus={inside && colAt === c ? focus!.i : null}
              dim={(openCol >= 0 && openCol !== c) || (menuKey != null && menuKey !== col.key)}
            />
          ))}
        </Scroller>
      </div>

      {/* The orb and its line are fixed under the cards. Full: the line rises to the middle of the screen. A card that
          is open hides the orb. */}
      <div class={`nest-bottom${openCol >= 0 ? " is-away" : ""}${ask.full ? " is-centred" : ""}`}>
        <VoiceWave {...WAVE} state={ask.wave} />
      </div>
      {/* One line under it: only a hint at rest, the status or the answer while the assistant is focused or busy. */}
      <div class={`nest-ask-dock${ask.full ? " is-gone" : ""}`} style={{ top: `${WAVE.y + WAVE.h + 8}px` }}>
        <span class={`nest-ask-hint${live ? " is-live" : ""}`}>{line}</span>
      </div>

      {/* The full chat: what was said above the line, the answer below it, each in its own colour. */}
      <div class={`nest-say nest-say-you${ask.full ? " is-on" : ""}`}>
        <small>{ask.status}</small>
        {ask.prompt && <b key={ask.turnId}>{ask.prompt}</b>}
      </div>
      <div class={`nest-say nest-say-reply${ask.full ? " is-on" : ""}`}>
        <p key={ask.turnId}>{ask.reply}</p>
      </div>

      {menuKey && (() => {
        const c = columns.findIndex((k) => k.key === menuKey);
        if (c < 0) return null;
        const cardX = ROW.x + layout.x[c] - rowScroll;
        const right = cardX + columnShape(columns[c]).w + 28;
        const mx = right + STYLE_W > 1920 - PAD ? cardX - STYLE_W - 28 : right;
        const k = columns[c];
        const name = k.kind === "media" ? k.name : k.label;
        return styleMenu ? <CardStyleMenu m={styleMenu} x={mx} y={ROW.y + LABEL_H} name={name} /> : <RemoveMenu x={mx} y={ROW.y + LABEL_H} name={name} />;
      })()}
      {menu && (
        <Glass x={MENU.x} y={MENU.y} w={MENU.w} h={menuTop(menuInfo) + menu.length * MENU.item + 12} class="nest-menu">
          {menuInfo.map((line, i) => (
            <small key={line} class="nest-menu-info" style={{ top: `${22 + i * INFO_H}px` }}>
              {line}
            </small>
          ))}
          {menu.map((m, i) => (
            <span key={m} class={`nest-menu-item${on("menu", i) ? " is-focus" : ""}`} style={{ top: `${menuTop(menuInfo) + i * MENU.item}px` }}>
              {m}
            </span>
          ))}
        </Glass>
      )}
    </>
  );
}
