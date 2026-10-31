// Raptor Spotlight search in glass. Layout only; data and keys live in app.tsx.
import { type Focus, windowOf } from "@secretary/tv-kit";
import { Glass, MediaTile, Scroller } from "@secretary/tv-kit/src/glass/index.ts";
import { badgeFor, posterUrl, type SearchResult } from "./apps.ts";

export const KEY_ROWS: readonly (readonly string[])[] = [
  ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T"],
  ["U", "V", "W", "X", "Y", "Z", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"],
  ["SPACE", "⌫", "CLEAR", "🎤 TV keyboard"],
];
/** Row index of the recent searches (when shown); results follow it. */
export const RECENT_ROW = KEY_ROWS.length;

const PAD = 80;
const KEY_W = 76;
const KEY_H = 72;
const KEY_STRIDE = 84;
const WIDE_W = 250;
const WIDE_STRIDE = 264;
const KEYS_Y = 206;
const ROW_STRIDE = 88;
const RECENT_Y = KEYS_Y + 3 * ROW_STRIDE + 10;
const RESULTS_Y = 640;
const POSTER_W = 200;
const POSTER_H = 300;
const POSTER_STRIDE = 224;

interface Props {
  focus: Focus;
  time: string;
  query: string;
  imeActive: boolean;
  recent: readonly string[];
  showRecent: boolean;
  results: readonly SearchResult[];
  status: string;
}

/** Recent-search chips are as wide as their text. */
function chipWidth(label: string): number {
  return 64 + label.length * 14;
}

export function Search({ focus, time, query, imeActive, recent, showRecent, results, status }: Props) {
  const on = (row: number, col: number) => focus.row === row && focus.col === col;
  const resultsRow = showRecent ? RECENT_ROW + 1 : RECENT_ROW;
  const onResults = focus.row === resultsRow;
  const [from, to] = windowOf(onResults ? focus.col : 0, results.length, 2, 9);
  const shift = onResults ? Math.max(0, focus.col - 3) * POSTER_STRIDE : 0;

  // Long terms are cut so eight recent chips still fit across the page.
  const chips = showRecent ? [...recent.map((t) => `🕒 ${t.length > 16 ? `${t.slice(0, 15)}…` : t}`), "✕ Clear"] : [];
  let chipX = PAD + 150;

  return (
    <>
      <Glass x={PAD} y={96} w={1420} h={68} class="nest-search-pill">
        <span class="nest-search-icon">⌕</span>
        {query ? (
          <span class="nest-search-query">
            {query}
            <i class="nest-caret" />
          </span>
        ) : (
          <span class="nest-search-hint">{imeActive ? "Listening / TV keyboard open…" : "Search movies, series and anime"}</span>
        )}
        <span class="nest-keycap">CH+ home</span>
      </Glass>
      <div class="nest-search-clock" style={{ left: "1560px", top: "100px" }}>
        {time}
      </div>

      {KEY_ROWS.map((row, r) =>
        row.map((k, c) => {
          const wide = r === 2;
          return (
            <Glass
              key={`${r}:${k}`}
              x={PAD + c * (wide ? WIDE_STRIDE : KEY_STRIDE)}
              y={KEYS_Y + r * ROW_STRIDE}
              w={wide ? WIDE_W : KEY_W}
              h={KEY_H}
              class="nest-key"
              focused={on(r, c)}
            >
              <span>{k}</span>
            </Glass>
          );
        }),
      )}

      {showRecent && (
        <>
          <div class="nest-recent-label" style={{ left: `${PAD}px`, top: `${RECENT_Y + 14}px` }}>
            Recent
          </div>
          {chips.map((label, c) => {
            const w = chipWidth(label);
            const x = chipX;
            chipX += w + 14;
            return (
              <Glass key={c} x={x} y={RECENT_Y} w={w} h={60} class="nest-recent" focused={on(RECENT_ROW, c)}>
                <span>{label}</span>
              </Glass>
            );
          })}
        </>
      )}

      <div class="nest-label" style={{ left: `${PAD}px`, top: `${RESULTS_Y - 54}px` }}>
        {status}
      </div>
      {results.length > 0 && (
        <Scroller x={PAD} y={RESULTS_Y} w={1760} h={POSTER_H + 50} axis="x" offset={shift}>
          {results.slice(from, to).map((item, k) => {
            const c = from + k;
            return (
              <MediaTile
                key={`${item.type}:${item.title.id}`}
                x={c * POSTER_STRIDE}
                y={0}
                w={POSTER_W}
                h={POSTER_H}
                src={posterUrl(item.title)}
                badge={c === 0 ? `★ ${badgeFor(item)}` : badgeFor(item)}
                focused={onResults && c === focus.col}
              />
            );
          })}
        </Scroller>
      )}
      {onResults && results[focus.col] && (
        <div class="nest-result-name" style={{ left: `${PAD}px`, top: `${RESULTS_Y + POSTER_H + 40}px` }}>
          {results[focus.col].title.name}
        </div>
      )}
    </>
  );
}
