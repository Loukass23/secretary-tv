// Secretary's one search (screens 6 and 14 of the 2026-11-24 review), opened from the header's search button, the
// remote's Search key and CH-, from the home screen and from inside the catalog alike. The shared header on top; a
// compact keyboard in a glass panel on the right; the results fill the rest and follow the typing (live-search.ts:
// throttled, stale answers dropped). Only the result rows around focus are rendered. Below the keys, a QR code opens a
// phone keyboard on Secretary Desk (phone-keys.ts) whose typing lands in the field.
import { getTvInputBridge, useKeys } from "@secretary/tv-kit";
import { Glass, Header, type HeaderButton, type HeaderPerson, InfoPanel, ListCard, POSTER, PosterTile, Scroller } from "@secretary/tv-kit/src/glass/index.ts";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { ratingLabel } from "@secretary/catalog-kit/src/lib/cinemeta.ts";
import { badgeFor, posterUrl, type SearchResult } from "./apps.ts";
import { HEADER_ORDER } from "./home.tsx";
import { liveSearch, type LiveSearchState } from "./live-search.ts";
import { HEADER_PROFILE, HEADER_SEARCH } from "./nest-nav.ts";
import { phoneUrl, typeCode, watchPhone } from "./phone-keys.ts";
import { QrCode } from "./qr.tsx";
import { backFrom, clamp, KEY_COLS, KEY_ROWS, keyAt, RESULT_COLS, type SearchFocus, type SearchLens, START, step, typeKey } from "./search-nav.ts";

const PAD = 80;
/** The keyboard panel, right; `pad` is its inner margin. */
const PANEL = { x: 1360, y: 150, w: 480, pad: 24 } as const;
const FIELD_H = 72;
const KEY = { w: 64, h: 60, gap: 8 } as const;
const KEYS_Y = PANEL.pad + FIELD_H + 24;
const ACTIONS_Y = KEYS_Y + (KEY_ROWS.length - 1) * (KEY.h + KEY.gap);
const QR = { size: 168, y: ACTIONS_Y + KEY.h + 32 } as const;
/** The results, left of the panel. */
const GRID = { x: PAD, y: 270, w: PANEL.x - PAD - 60 } as const;
const ROW_STRIDE = POSTER.h + POSTER.gap;
const COL_STRIDE = POSTER.w + POSTER.gap;
const RECENT = { y: 278, w: 680, h: 80, stride: 94 } as const;

const RECENT_KEY = "sectv:recent-searches:v1";
const MAX_RECENT = 7;
const SEARCH_BUTTON = HEADER_ORDER.indexOf(HEADER_SEARCH);

function loadRecent(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string" && x.trim().length > 1).slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}
function saveRecent(list: string[]): string[] {
  try {
    if (list.length) localStorage.setItem(RECENT_KEY, JSON.stringify(list));
    else localStorage.removeItem(RECENT_KEY);
  } catch {
    // Private storage: recent searches live for this visit only.
  }
  return list;
}
const addRecent = (list: readonly string[], term: string) => {
  const t = term.trim();
  return t.length < 2 ? [...list] : [t, ...list.filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, MAX_RECENT);
};

export interface SearchScreenProps {
  time: string;
  person: HeaderPerson;
  /** The home screen's header buttons (home.tsx headerButtons), in their order. */
  buttons: readonly HeaderButton[];
  /** One search request; abort it when `signal` fires. */
  find(query: string, signal: AbortSignal): Promise<readonly SearchResult[]>;
  initialQuery?: string;
  /** Each change of the typed text, so the next visit opens on it. */
  onQuery?(text: string): void;
  /** Secretary Desk's address: the panel shows the phone keyboard's QR code. Empty or absent: no QR code. */
  desk?: string;
  /** OK on a result. */
  onOpen(hit: SearchResult): void;
  /** OK on a header item other than search, as nest-nav numbers them. */
  onHeader(i: number): void;
  /** Back (one press, whatever is typed), and CH+. */
  onClose(): void;
}

const EMPTY: LiveSearchState<SearchResult> = { query: "", results: [], answered: "", searching: false, failed: false };

export function SearchScreen({ time, person, buttons, find, initialQuery = "", onQuery, desk, onOpen, onHeader, onClose }: SearchScreenProps) {
  const [text, setText] = useState(initialQuery);
  const [found, setFound] = useState<LiveSearchState<SearchResult>>(EMPTY);
  const [focus, setFocus] = useState<SearchFocus>(START);
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const [ime, setIme] = useState(false);
  const lastKey = useRef({ row: 0, col: 0 });
  const lastResult = useRef(0);
  if (focus.area === "keys") lastKey.current = { row: focus.row, col: focus.col };
  if (focus.area === "results") lastResult.current = focus.i;

  const findRef = useRef(find);
  findRef.current = find;
  const onQueryRef = useRef(onQuery);
  onQueryRef.current = onQuery;
  const search = useMemo(() => liveSearch<SearchResult>({ find: (q, s) => findRef.current(q, s), onChange: setFound }), []);
  useEffect(() => () => search.dispose(), []);
  useEffect(() => {
    search.set(text);
    onQueryRef.current?.(text);
  }, [text]);

  // The phone keyboard: one code for each time the screen opens.
  const code = useMemo(() => (desk ? typeCode() : ""), [desk]);
  useEffect(() => (desk ? watchPhone(desk, code, (t) => setText(t)) : undefined), [desk, code]);

  const showRecent = !text.trim() && recent.length > 0;
  const results = text.trim() ? found.results : [];
  const lens: SearchLens = {
    results: results.length,
    recent: showRecent ? recent.length + 1 : 0,
    buttons: buttons.length,
    home: SEARCH_BUTTON,
    lastKey: lastKey.current,
    lastResult: lastResult.current,
  };
  useEffect(() => {
    const next = clamp(focus, lens);
    if (next !== focus) setFocus(next);
  }, [lens.results, lens.recent]);

  const remember = (term: string) => setRecent((list) => saveRecent(addRecent(list, term)));

  const tvKeyboard = () => {
    const opened = getTvInputBridge().open(text, {
      onChange: (v) => setText(v),
      onCommit: (v) => {
        setIme(false);
        setText(v);
      },
      onCancel: () => setIme(false),
    });
    setIme(opened);
  };

  useKeys(true, (key) => {
    if (key === "ChannelUp") return void onClose();
    if (key === "ChannelDown" || key === "Search") return void setFocus({ area: "keys", ...lastKey.current });
    if (key === "SearchVoice") return void tvKeyboard();
    if (key === "Back") {
      if (backFrom(focus) === "keys") return void setFocus({ area: "keys", ...lastKey.current });
      return void onClose();
    }
    if (key === "Enter") {
      if (focus.area === "header") {
        if (focus.i === SEARCH_BUTTON) return void setFocus({ area: "keys", ...lastKey.current });
        return void onHeader(focus.i < 0 ? HEADER_PROFILE : HEADER_ORDER[focus.i]);
      }
      const k = keyAt(focus);
      if (k) return void setText((t) => typeKey(t, k));
      if (focus.area === "recent") {
        if (focus.i < recent.length) {
          const term = recent[focus.i];
          remember(term);
          setText(term);
          return void setFocus({ area: "keys", ...lastKey.current });
        }
        setRecent(saveRecent([]));
        return void setFocus(START);
      }
      if (focus.area === "results") {
        const hit = results[focus.i];
        if (!hit) return;
        remember(text);
        return void onOpen(hit);
      }
      return;
    }
    if (key === "Left" || key === "Right" || key === "Up" || key === "Down") {
      const next = step(focus, key, lens);
      if (next !== focus) setFocus(next);
      return;
    }
    return false;
  });

  // A physical keyboard types too (a USB keyboard on the TV). Backspace stays Back, as on the
  // workbench's remote; the panel's Delete key deletes.
  useEffect(() => {
    if (ime) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.length === 1 && /^[a-z0-9 ]$/i.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        setText((t) => typeKey(t, e.key === " " ? "space" : e.key.toLowerCase()));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [ime]);

  const q = text.trim();
  const focused = focus.area === "results" ? results[focus.i] : undefined;
  const caption = captionFor(q, found, results.length, showRecent, focused, Boolean(desk));

  // The grid scrolls a row at a time, keeping the focused row in view, and draws only the rows around it.
  const atRow = Math.floor((focus.area === "results" ? focus.i : lastResult.current) / RESULT_COLS);
  const offset = Math.max(0, atRow - 1) * ROW_STRIDE;
  const fromRow = Math.max(0, atRow - 2);
  const toRow = atRow + 3;
  const shown = results.slice(fromRow * RESULT_COLS, toRow * RESULT_COLS);

  return (
    <>
      <Header
        time={time}
        person={person}
        buttons={buttons.map((b, k) => (k === SEARCH_BUTTON ? { ...b, badge: true } : b))}
        focus={focus.area === "header" ? (focus.i < 0 ? "person" : focus.i) : null}
      />

      <InfoPanel x={PAD} y={150} w={GRID.w} kicker={caption.kicker} title={caption.title} meta={caption.meta} lines={1} />

      {showRecent &&
        [...recent, "Clear recent searches"].map((term, i) => (
          <ListCard
            key={`${i}:${term}`}
            x={PAD}
            y={RECENT.y + i * RECENT.stride}
            w={RECENT.w}
            h={RECENT.h}
            frost={false}
            class={i === recent.length ? "nest-recent-clear" : undefined}
            title={term}
            focused={focus.area === "recent" && focus.i === i}
          />
        ))}

      {results.length > 0 && (
        <Scroller x={GRID.x} y={GRID.y} w={GRID.w} h={1080 - GRID.y - 30} axis="y" offset={offset}>
          {shown.map((hit, k) => {
            const i = fromRow * RESULT_COLS + k;
            return (
              <PosterTile
                key={`${hit.type}:${hit.title.id}`}
                x={(i % RESULT_COLS) * COL_STRIDE}
                y={Math.floor(i / RESULT_COLS) * ROW_STRIDE}
                src={posterUrl(hit.title)}
                badge={badgeFor(hit)}
                focused={focus.area === "results" && focus.i === i}
              />
            );
          })}
        </Scroller>
      )}

      <Glass x={PANEL.x} y={PANEL.y} w={PANEL.w} h={(desk ? QR.y + QR.size : ACTIONS_Y + KEY.h) + PANEL.pad} class="nest-kb">
        <div class="nest-kb-field" style={{ left: `${PANEL.pad}px`, top: `${PANEL.pad}px`, width: `${PANEL.w - 2 * PANEL.pad}px`, height: `${FIELD_H}px` }}>
          {text ? <span class="nest-kb-text">{text}</span> : <span class="nest-kb-hint">{ime ? "Typing on the TV keyboard…" : "Type a title"}</span>}
          <i class="nest-kb-caret" />
        </div>
        {KEY_ROWS.map((row, r) =>
          row.map((k, c) => {
            const wide = row.length < KEY_COLS;
            const w = wide ? 2 * KEY.w + KEY.gap : KEY.w;
            return (
              <span
                key={k}
                class={`nest-kb-key${wide ? " is-word" : ""}${focus.area === "keys" && focus.row === r && focus.col === c ? " is-focus" : ""}`}
                style={{ left: `${PANEL.pad + c * (w + KEY.gap)}px`, top: `${KEYS_Y + r * (KEY.h + KEY.gap)}px`, width: `${w}px`, height: `${KEY.h}px` }}
              >
                {KEY_LABEL[k] ?? k}
              </span>
            );
          }),
        )}
        {desk && (
          <div class="nest-kb-phone" style={{ left: `${PANEL.pad}px`, top: `${QR.y}px`, width: `${PANEL.w - 2 * PANEL.pad}px` }}>
            <span class="nest-kb-qr">
              <QrCode text={phoneUrl(desk, code)} size={QR.size - 16} />
            </span>
            <span class="nest-kb-phone-text">
              <b>Type on your phone</b>
              <small>Scan with the camera: your phone's keyboard types here.</small>
            </span>
          </div>
        )}
      </Glass>
    </>
  );
}

const KEY_LABEL: Record<string, string> = { space: "Space", delete: "Delete", clear: "Clear" };

const KIND = { movie: "Film", series: "Show", anime: "Anime" } as const;

function captionFor(
  q: string,
  found: LiveSearchState<SearchResult>,
  count: number,
  showRecent: boolean,
  focused: SearchResult | undefined,
  phone = false,
): { kicker: string; title: string; meta?: string[] } {
  if (!q) {
    return showRecent
      ? { kicker: "Recent searches", title: "Search films, shows and anime" }
      : { kicker: "Search", title: "Search films, shows and anime", meta: [phone ? "Type on the keyboard, or on your phone" : "Type on the keyboard"] };
  }
  if (q.length < 2) return { kicker: "Search", title: "Keep typing…" };
  if (count > 0) {
    const kicker = `${count} result${count === 1 ? "" : "s"}${found.searching ? " · updating" : ""}`;
    if (focused) return { kicker, title: focused.title.name, meta: [KIND[focused.type], focused.title.year ?? "", ratingLabel(focused.title.rating)] };
    return { kicker, title: `Results for “${found.answered}”` };
  }
  if (found.searching) return { kicker: "Searching…", title: `“${q}”` };
  if (found.failed) return { kicker: "Search", title: "Search is not answering", meta: ["Check the TV's internet connection, then type again"] };
  return { kicker: "No results", title: `Nothing found for “${q}”` };
}
