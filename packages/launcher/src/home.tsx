// The Nest home screen (docs/launcher.md): the person top left, a small clock and quiet buttons top right, and one row of
// content cards, the Assistant first, then the weather over the calendar, Recent and one per app, running off the right
// edge. The assistant also sits under the cards (the compact mode, with its line and one line of text), or takes the
// whole screen (the chat, opened from its card). Layout only; data and keys live in app.tsx.
import { useRef } from "preact/hooks";
import { Glass, Glow, Header, Icon, type IconName, Scroller, VoiceWave, type WaveState } from "@secretary/tv-kit/src/glass/index.ts";
import { type CardStyle, LAYOUT_LABEL, LAYOUTS, MOVE_LINE, REMOVE_LINE, SIZE_LABEL, SIZE_LINE, type StyleMenu } from "./card-style.ts";
import { CARD_H, columnShape, expands, itemBox, LABEL_H, RowCard, type RowColumn, rowLayout } from "./cards.tsx";
import { type Focus, HEADER_BELL, HEADER_LIGHTS, HEADER_PARTY, HEADER_PICTURE, HEADER_PROFILE, HEADER_SEARCH, HEADER_SETTINGS, HEADER_SOUND } from "./nest-nav.ts";

const PAD = 80;
/** The header buttons, left to right, as nest-nav numbers them. */
const HEADER_ORDER = [HEADER_PARTY, HEADER_SEARCH, HEADER_LIGHTS, HEADER_PICTURE, HEADER_SOUND, HEADER_SETTINGS, HEADER_BELL];

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
  /** The move/remove menu (a long OK on any other card), while it is open. */
  removeMenu?: CardMenu | null;
  /** The menu on a tile of an opened media card (a long OK on it), while it is open. */
  tileMenu?: TileMenu | null;
  /** The card being moved (Left and Right), by key. */
  moving?: string | null;
  /** The TV's picture mode, when SmartThings reports it; the Picture button's icon follows it. */
  pictureMode?: string;
  /** Whether the sound system is on, when SmartThings shows one; the Sound button's icon follows it. */
  soundOn?: boolean;
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
  const lines = [...LAYOUTS.map((l) => LAYOUT_LABEL[l]), `Size  ‹ ${SIZE_LABEL[m.style.size]} ›`, "Move", "Remove from home"];
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
        {m.line === REMOVE_LINE ? "OK removes · Back keeps" : m.line === MOVE_LINE ? "OK then ◀ ▶ moves it" : "OK keeps · Back undoes"}
      </small>
    </Glass>
  );
}

/** A long-OK menu on the other cards: move the card, or take it off the home screen. */
export interface CardMenu {
  key: string;
  /** 0 Move, 1 Remove from home. */
  line: number;
}

/** A long-OK menu on a title in an opened media card: the lines (catalog-kit titleMenu) and the focused one. */
export interface TileMenu {
  name: string;
  lines: { id: string; label: string }[];
  at: number;
}

function TitleTileMenu({ m }: { m: TileMenu }) {
  return (
    <Glass x={1920 - PAD - STYLE_W} y={ROW.y + LABEL_H} w={STYLE_W} h={96 + m.lines.length * STYLE_LINE + 24} class="nest-menu nest-style">
      <span class="nest-kicker nest-style-head">{m.name}</span>
      {m.lines.map((l, i) => (
        <span key={l.id} class={`nest-menu-item${m.at === i ? " is-focus" : ""}`} style={{ top: `${76 + i * STYLE_LINE}px` }}>
          {l.label}
        </span>
      ))}
    </Glass>
  );
}

function RemoveMenu({ m, x, y, name }: { m: CardMenu; x: number; y: number; name: string }) {
  const lines = ["Move", "Remove from home"];
  return (
    <Glass x={x} y={y} w={STYLE_W} h={96 + lines.length * STYLE_LINE + 64} class="nest-menu nest-style">
      <span class="nest-kicker nest-style-head">{name}</span>
      {lines.map((label, i) => (
        <span key={label} class={`nest-menu-item${m.line === i ? " is-focus" : ""}`} style={{ top: `${76 + i * STYLE_LINE}px` }}>
          {label}
        </span>
      ))}
      <small class="nest-style-hint" style={{ top: `${88 + lines.length * STYLE_LINE}px` }}>
        {m.line === 1 ? "OK removes · Back keeps" : "OK then ◀ ▶ moves it"}
      </small>
    </Glass>
  );
}

/** While a card is being moved: a hint under the row, the card lifted and the others stepped back. */
function MoveHint() {
  return <small class="nest-move-hint">◀ ▶ moves the card · OK keeps · Back puts it back</small>;
}

/** The style a card shows: the menu's while it is open on that card. */
export const shownStyle = (m: StyleMenu | null | undefined, key: string, saved: CardStyle): CardStyle => (m?.key === key ? m.style : saved);

export function Home({ focus, time, ask, menu, menuInfo = [], links = [], glow, columns, open, status, me, styleMenu, removeMenu, tileMenu, moving, pictureMode, soundOn }: Props) {
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
  const menuKey = styleMenu?.key ?? removeMenu?.key ?? moving ?? null;
  // The wave shows only while someone speaks; the line under it says what is going on, or hints at what to do.
  const busy = ask.wave !== "idle";
  const live = busy || ask.focused;
  const line = busy ? ask.status || ask.reply : ask.focused ? "Press OK to talk" : "Ask Assistant";

  return (
    <>
      {/* The one header (tv-kit Header): the person top left, a small clock and the quiet buttons top right. */}
      <Header
        time={time}
        person={{ name: me?.name ?? "Secretary", sub: status || <Links links={links} />, color: me?.color, img: me?.img }}
        buttons={(["party", "search", "lights", pictureIcon(pictureMode), soundOn === false ? "hifi-off" : "hifi", "settings", "bell"] as const satisfies readonly IconName[]).map((icon, k) => ({
          key: String(k),
          icon,
          badge: k === 6 ? open : undefined,
        }))}
        focus={focus?.area !== "header" ? null : focus.i === HEADER_PROFILE ? "person" : HEADER_ORDER.indexOf(focus.i)}
      />

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
              lifted={moving === col.key}
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
      <div class={`nest-ask-dock${ask.full || openCol >= 0 ? " is-gone" : ""}`} style={{ top: `${WAVE.y + WAVE.h + 8}px` }}>
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

      {moving && <MoveHint />}
      {tileMenu && <TitleTileMenu m={tileMenu} />}
      {menuKey && !moving && (() => {
        const c = columns.findIndex((k) => k.key === menuKey);
        if (c < 0) return null;
        const cardX = ROW.x + layout.x[c] - rowScroll;
        const right = cardX + columnShape(columns[c]).w + 28;
        const mx = right + STYLE_W > 1920 - PAD ? cardX - STYLE_W - 28 : right;
        const k = columns[c];
        const name = k.kind === "media" ? k.name : k.label;
        return styleMenu ? <CardStyleMenu m={styleMenu} x={mx} y={ROW.y + LABEL_H} name={name} /> : <RemoveMenu m={removeMenu!} x={mx} y={ROW.y + LABEL_H} name={name} />;
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
