import { keyName } from "@secretary/tv-kit";
import { Glass, GlassRoot } from "@secretary/tv-kit/src/glass/index.ts";
import { useEffect, useRef, useState } from "preact/hooks";
import { type MenuKey, type MenuPage, type MenuRow, openingRow, startMenu, stepMenu, TOP_PAGE, windowRows } from "../lib/playermenu.ts";

const W = 620;
const ROW_H = 68;
const HEAD_H = 104;
const SHOWN = 8;
const MENU_KEYS = new Set(["Up", "Down", "Left", "Right", "Enter", "Back"]);

/**
 * The player's options (Up opens it): one smoked glass panel on the right, a list of pages (Audio, Picture, Room, Info).
 * It takes every key while open, like the control centre: Up and Down move, OK opens a page or chooses, Left and Right
 * cycle a value, Back goes up a page and then closes. The video plays on behind it; the panel is flat glass with no frost.
 */
export function PlayerMenu({
  open,
  pageOf,
  heading,
  onPick,
  onClose,
}: {
  open: boolean;
  pageOf(id: string): MenuPage | undefined;
  heading: string;
  onPick(page: string, row: MenuRow, dir: -1 | 0 | 1): void;
  onClose(): void;
}) {
  const [nav, setNav] = useState(startMenu);
  const navRef = useRef(nav);
  navRef.current = nav;
  // The props change under the key handler (a pick checks another row), so it reads the latest through a ref.
  const latest = useRef({ pageOf, onPick, onClose });
  latest.current = { pageOf, onPick, onClose };

  useEffect(() => {
    if (open) setNav({ stack: [TOP_PAGE], row: 0 });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const name = keyName(e);
      if (!name || name === "ChannelUp") return;
      e.stopImmediatePropagation();
      e.preventDefault();
      if (!MENU_KEYS.has(name)) return;
      const step = stepMenu(navRef.current, name as MenuKey, latest.current.pageOf);
      if (step.close) return latest.current.onClose();
      setNav(step.state);
      if (step.pick) latest.current.onPick(step.pick.page, step.pick.row, step.pick.dir);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  const page = pageOf(nav.stack[nav.stack.length - 1]);
  const rows = page?.rows ?? [];
  const win = windowRows(rows, nav.row, SHOWN);
  const h = HEAD_H + Math.max(1, win.rows.length) * ROW_H + 24;
  return (
    <GlassRoot mode="flat" class="pm-root">
      <Glass x={1920 - 80 - W} y={60} w={W} h={h} frost={false} class={`pm${open ? " is-open" : ""}`}>
        <div class="pm-head">
          <span class="pm-title">{page?.title ?? ""}</span>
          <span class="pm-sub">{heading}</span>
        </div>
        {win.rows.map((row, i) => (
          <div
            key={row.id}
            class={`pm-row${open && win.from + i === nav.row ? " is-focus" : ""}`}
            style={{ top: `${HEAD_H + i * ROW_H}px` }}
          >
            <span class="pm-label">
              {row.checked && <i class="pm-dot" />}
              {row.label}
            </span>
            <span class="pm-val">{row.go ? `${row.value ?? ""} ›` : (row.value ?? "")}</span>
          </div>
        ))}
        {!rows.length && <div class="pm-empty">{page?.empty ?? "Nothing here"}</div>}
      </Glass>
    </GlassRoot>
  );
}

export { openingRow };
