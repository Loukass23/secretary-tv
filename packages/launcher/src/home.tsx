// The Secretary home screen (docs/launcher.md): the person top left, a small clock and quiet buttons top right, and one row of
// content cards, the Assistant first, then the weather, Calendar, Recent and one per app, running off the right
// edge. App.tsx renders the shared bottom AssistantDock and ConversationOverlay across screens.
import { useRef } from "preact/hooks";
import { Glass, Glow, Header, type HeaderButton, Icon, type IconName, Scroller, type WaveState } from "@secretary/tv-kit/src/glass/index.ts";
import { type CardStyle, LAYOUT_LABEL, LAYOUTS, SIZE_LABEL, SIZE_LINE, type StyleMenu } from "./card-style.ts";
import { CARD_H, columnHeight, columnShape, expands, itemBox, LABEL_H, RowCard, type RowColumn, rowLayout } from "./cards.tsx";
import { WATCH_TOGETHER } from "./config.ts";
import { type Focus, HEADER_BELL, HEADER_PROFILE, headerItems } from "./nest-nav.ts";

const PAD = 80;
export const HEADER_ITEMS = headerItems(WATCH_TOGETHER);
export const HEADER_ORDER = HEADER_ITEMS.filter((i) => i !== HEADER_PROFILE);

const ICONS = (pictureMode: string | undefined, soundOn: boolean | undefined): readonly IconName[] => [
  "party",
  "party",
  "search",
  "lights",
  pictureIcon(pictureMode),
  soundOn === false ? "hifi-off" : "hifi",
  "settings",
  "bell",
];

export const headerButtons = (pictureMode: string | undefined, soundOn: boolean | undefined, open: number): HeaderButton[] => {
  const icons = ICONS(pictureMode, soundOn);
  return HEADER_ORDER.map((i) => ({ key: String(i), icon: icons[i], badge: i === HEADER_BELL ? open : undefined }));
};

function pictureIcon(mode: string | undefined): IconName {
  const m = (mode ?? "").toLowerCase();
  return m.startsWith("dynamic") ? "picture-bright" : m.startsWith("eco") ? "picture-dim" : "picture";
}

const ROW = { x: PAD, y: 236, h: LABEL_H + CARD_H + 240 };
const VIEW_RIGHT = 1920 - 60;
const MENU = { x: PAD, y: 150, w: 480, item: 76 };

export interface AskView {
  wave: WaveState;
  status: string;
  prompt?: string;
  reply: string;
  turnId: number;
  focused: boolean;
  full: boolean;
}

interface Props {
  focus: Focus | null;
  time: string;
  ask: AskView;
  menu: readonly string[] | null;
  menuInfo?: readonly string[];
  links?: readonly { icon: IconName; off?: boolean }[];
  glow?: string;
  columns: readonly RowColumn[];
  open: number;
  status: string;
  me: { name: string; color?: string; img?: string } | null;
  styleMenu?: StyleMenu | null;
  removeMenu?: CardMenu | null;
  tileMenu?: TileMenu | null;
  moving?: string | null;
  pictureMode?: string;
  soundOn?: boolean;
}

const INFO_H = 36;
const menuTop = (info: readonly string[]) => (info.length ? 22 + info.length * INFO_H + 20 : 12);

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

function CardStyleMenu({ m, x, y, name }: { m: StyleMenu; x: number; y: number; name: string }) {
  const lines = [...LAYOUTS.map((l) => LAYOUT_LABEL[l]), `Size  ‹ ${SIZE_LABEL[m.style.size]} ›`, "Move", "Remove from home"];
  return (
    <Glass x={x} y={y} w={STYLE_W} h={96 + lines.length * STYLE_LINE + 24} class="nest-menu nest-style">
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
    </Glass>
  );
}

export interface CardMenu {
  key: string;
  line: number;
}

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
    <Glass x={x} y={y} w={STYLE_W} h={96 + lines.length * STYLE_LINE + 24} class="nest-menu nest-style">
      <span class="nest-kicker nest-style-head">{name}</span>
      {lines.map((label, i) => (
        <span key={label} class={`nest-menu-item${m.line === i ? " is-focus" : ""}`} style={{ top: `${76 + i * STYLE_LINE}px` }}>
          {label}
        </span>
      ))}
    </Glass>
  );
}

export const shownStyle = (m: StyleMenu | null | undefined, key: string, saved: CardStyle): CardStyle => (m?.key === key ? m.style : saved);

export function Home({ focus, time, ask, menu, menuInfo = [], links = [], glow, columns, open, status, me, styleMenu, removeMenu, tileMenu, moving, pictureMode, soundOn }: Props) {
  const on = (area: Focus["area"], i: number) => focus?.area === area && focus.i === i;
  const openCol = focus?.area === "row" && focus.inside && expands(columns[focus.col ?? 0]) ? (focus.col ?? 0) : -1;
  const layout = rowLayout(columns, openCol);
  const lastCol = useRef(0);
  if (focus?.area === "row") lastCol.current = focus.col ?? 0;
  const colAt = Math.min(lastCol.current, Math.max(0, columns.length - 1));
  const left = ROW.x + (layout.x[colAt] ?? 0);
  const rowScroll = Math.max(0, Math.min(left - PAD, left + (layout.w[colAt] ?? 0) - VIEW_RIGHT));
  const inside = focus?.area === "row" && focus.inside;
  const focusBox = inside && columns[colAt] && focus.i >= 0 ? itemBox(columns[colAt], focus.i, colAt === openCol) : null;
  const pickedCol = focus?.area === "row" && !inside && !moving && columns[colAt] ? colAt : -1;
  const artCard = pickedCol >= 0 && ["media", "videos", "folders"].includes(columns[pickedCol].kind);
  const pickedBox = artCard ? { x: 0, y: 0, w: columnShape(columns[pickedCol]).w, h: columnHeight(columns[pickedCol]) } : null;
  const box = focusBox ?? pickedBox;
  const glowAt = box ? { x: ROW.x + layout.x[colAt] - rowScroll + box.x, y: ROW.y + LABEL_H + box.y, w: box.w, h: box.h } : null;
  const menuKey = styleMenu?.key ?? removeMenu?.key ?? moving ?? null;

  return (
    <>
      <Header
        time={time}
        person={{ name: me?.name ?? "Secretary", sub: status || <Links links={links} />, color: me?.color, img: me?.img }}
        buttons={headerButtons(pictureMode, soundOn, open)}
        focus={focus?.area !== "header" ? null : focus.i === HEADER_PROFILE ? "person" : HEADER_ORDER.indexOf(focus.i)}
      />

      <div class={`nest-glow${!focusBox && pickedBox ? " is-card" : ""}`}>
        <Glow at={glowAt} src={glow} />
      </div>

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
              dim={menuKey != null && menuKey !== col.key}
              away={openCol >= 0 && openCol !== c}
              behind={pickedCol >= 0 && pickedCol !== c && menuKey == null}
            />
          ))}
        </Scroller>
      </div>

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
