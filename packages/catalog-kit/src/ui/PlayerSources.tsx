// The sources sheet inside the player (lib/playersources.ts): the pause menu's Sources opens it over the paused video.
// The same lines and chips as the title page's sheet (ui/sheet.ts, ui/Detail.tsx), on the player's smoked glass with no
// frost (the video is a plane behind the page). Only the rows around focus are rendered; focus moves by transform.
import { keyName, windowOf } from "@secretary/tv-kit";
import { Glass, GlassRoot, ListCard, Segmented } from "@secretary/tv-kit/src/glass/index.ts";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { SHEET_START, type SheetNav, stepSheet } from "../lib/playersources.ts";
import { parseStreamInfo, type Stream } from "../lib/streams.ts";
import { applyFilters, type Filter, filterChips, filterLabel, focusable, isVerified, type SheetOrder, sheetRows, sourceLanguages } from "./sheet.ts";
import "./player.css";

const SHEET = { x: 1060, y: 60, w: 800, h: 960 };
const SOURCE_H = 112;
const SOURCE_STRIDE = SOURCE_H + 14;
const HEADER_STRIDE = 46;
const CHIPS_Y = 132;
const LIST_TOP = CHIPS_Y + 62;
const SHEET_KEYS = new Set(["Up", "Down", "Left", "Right", "Enter", "Back"]);

export interface PlayerSourcesProps {
  /** The sources, null while they are looked up, "error" when the search failed. */
  streams: readonly Stream[] | null | "error";
  /** The source playing now: marked, and first in the sheet. */
  playing?: Stream;
  /** "S1E5 The Long Night", or the film's name. */
  heading: string;
  order?: SheetOrder;
  /** Recently failed sources go last in their section (lib/deadlinks.ts). */
  isLow?: (s: Stream) => boolean;
  /** Takes the keys (false in the design workbench). */
  live?: boolean;
  onPick(s: Stream): void;
  onClose(): void;
}

export function PlayerSources({ streams, playing, heading, order = "grouped", isLow, live = true, onPick, onClose }: PlayerSourcesProps) {
  const list = Array.isArray(streams) ? streams : null;
  const [filters, setFilters] = useState<ReadonlySet<Filter>>(new Set());
  const [nav, setNav] = useState<SheetNav>(SHEET_START);
  const langOf = useMemo(() => {
    const m = new Map((list ?? []).map((s) => [s, sourceLanguages(s)]));
    return (s: Stream) => m.get(s) ?? sourceLanguages(s);
  }, [list]);
  const chips = useMemo(() => (list ? filterChips(list, langOf) : []), [list, langOf]);
  const { kept, hidden } = useMemo(() => (list ? applyFilters(list, filters, langOf) : { kept: [], hidden: 0 }), [list, filters, langOf]);
  const best = kept.find((s) => s === playing);
  const items = useMemo(() => sheetRows(kept, { best, order, isLow }), [kept, best, order, isLow]);
  const rowsAt = useMemo(() => focusable(items), [items]);
  const parsed = useMemo(() => new Map(kept.map((s) => [s, parseStreamInfo(s)])), [kept]);

  // The key handler reads the latest through a ref, like the options menu: the list changes under it.
  const latest = useRef({ nav, items, rowsAt, chips, onPick, onClose });
  latest.current = { nav, items, rowsAt, chips, onPick, onClose };
  useEffect(() => {
    if (!live) return;
    const onKey = (e: KeyboardEvent) => {
      const name = keyName(e);
      if (!name || name === "ChannelUp") return;
      e.stopImmediatePropagation();
      e.preventDefault();
      if (!SHEET_KEYS.has(name)) return;
      const l = latest.current;
      const step = stepSheet(l.nav, name, { rows: l.rowsAt.length, chips: l.chips.length });
      if (!step) return;
      if ("close" in step) return l.onClose();
      if ("nav" in step) return setNav(step.nav);
      if ("showAll" in step) return setFilters(new Set());
      if ("toggle" in step) {
        const f = l.chips[step.toggle];
        setFilters((on) => {
          const next = new Set(on);
          if (!next.delete(f)) next.add(f);
          return next;
        });
        return setNav({ row: 0, chip: l.nav.chip });
      }
      const at = l.items[l.rowsAt[step.pick]];
      if (at?.kind === "row") l.onPick(at.stream);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [live]);

  const ys: number[] = [];
  items.reduce((y, it) => (ys.push(y), y + (it.kind === "header" ? HEADER_STRIDE : SOURCE_STRIDE)), 0);
  const focusedAt = rowsAt[nav.row] ?? 0;
  const shift = Math.max(0, (ys[focusedAt] ?? 0) - 3 * SOURCE_STRIDE);
  const [from, to] = windowOf(focusedAt, items.length, 4, 8);
  const title = list
    ? `${list.length} source${list.length === 1 ? "" : "s"}${hidden ? ` · ${hidden} hidden by ${[...filters].map(filterLabel).join(", ")}` : ""}`
    : streams === "error"
      ? "The sources could not be found"
      : "Looking for sources…";

  return (
    <GlassRoot mode="flat" class="ply-src-root">
      <Glass {...SHEET} frost={false} class="ply-src">
        <span class="ply-state">{`Change source · ${heading}`}</span>
        <h2>{title}</h2>
        {list && (
          <Segmented
            x={30}
            y={CHIPS_Y}
            w={SHEET.w - 60}
            h={48}
            class="ply-src-chips"
            items={chips.map((f) => `${filters.has(f) ? "✓ " : ""}${filterLabel(f)}`)}
            picked={-1}
            focusIndex={nav.chip ?? -1}
          />
        )}
        {list && !kept.length && (
          <div class="ply-src-sec" style={{ left: "36px", top: `${LIST_TOP}px` }}>
            {hidden ? "All hidden by the filters · OK shows all" : "No sources for this one"}
          </div>
        )}
        {list && (
          <div class="sg-clip" style={{ left: "0px", top: `${LIST_TOP - 10}px`, width: `${SHEET.w}px`, height: `${SHEET.h - LIST_TOP}px` }}>
            <div class="sg-scroll" style={{ transform: `translate3d(30px,${10 - shift}px,0)` }}>
              {items.slice(from, to).map((it, k) => {
                const idx = from + k;
                if (it.kind === "header") {
                  return (
                    <div key={it.key} class="ply-src-sec" style={{ top: `${ys[idx]}px` }}>
                      {it.label === "Best for this TV" ? "Playing now" : it.label}
                    </div>
                  );
                }
                const st = it.stream;
                const p = parsed.get(st)!;
                const tags = `${isVerified(st) ? "✔ " : ""}${p.badges.join(" · ")}${p.badges.length ? " · " : ""}${st.name}`;
                return (
                  <ListCard
                    key={it.key}
                    x={0}
                    y={ys[idx]}
                    w={SHEET.w - 60}
                    h={SOURCE_H}
                    frost={false}
                    title={p.cleanTitle}
                    sub={st.notice ? "ⓘ A message from the provider, not a film" : st === playing ? `▶ Playing now · ${tags}` : tags}
                    meta={st.notice ? "Notice" : (p.size ?? "Cached")}
                    color={st === playing ? "var(--sg-accent)" : undefined}
                    focused={idx === focusedAt && nav.chip == null}
                  />
                );
              })}
            </div>
          </div>
        )}
      </Glass>
    </GlassRoot>
  );
}
