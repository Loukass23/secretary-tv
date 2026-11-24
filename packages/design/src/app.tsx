// The workbench shell: a toolbar, the 1920x1080 stage scaled into the window, and a side panel with the
// linter and the remote. Its own chrome is desktop UI; only what is on the stage is TV code.
import { type Backdrop, drawBackdrop, type GlassMode, type Theme, TINTS, type TintName } from "@secretary/tv-kit/src/glass/index.ts";
import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { type Art, drawArt } from "./art.ts";
import { type Finding, lintTree } from "./lint.ts";
import { ComponentsPage } from "./pages/components.tsx";
import { SCREENS, ScreensPage } from "./pages/screens.tsx";
import { TokensPage } from "./pages/tokens.tsx";
import { RemotePad } from "./remote.tsx";

export interface PageProps {
  mode: GlassMode;
  theme: Theme;
  backdrop: Backdrop | null;
  focusAll: boolean;
}

const PAGES = ["tokens", "components", "screens"] as const;
const GROUPS = ["Controls and cards", "Media and motion", "Icons"];
const MODES: readonly GlassMode[] = ["fake", "flat", "live"];
const TINT_NAMES = Object.keys(TINTS) as TintName[];

interface State {
  page: (typeof PAGES)[number];
  group: number;
  screen: number;
  theme: Theme;
  tint: TintName;
  mode: GlassMode;
  fit: boolean;
  safe: boolean;
  grid: boolean;
  lint: boolean;
  warn: boolean;
  remote: boolean;
  focusAll: boolean;
}

const DEFAULTS: State = {
  page: "components",
  group: 0,
  screen: 0,
  theme: "night",
  tint: "orange",
  mode: "fake",
  fit: true,
  safe: false,
  grid: false,
  lint: true,
  warn: true,
  remote: true,
  focusAll: false,
};

/** The state lives in the query string, so a reload or a shared link opens the same view. */
function readState(): State {
  const q = new URLSearchParams(location.search);
  const s = { ...DEFAULTS } as Record<string, unknown>;
  for (const [k, v] of Object.entries(DEFAULTS)) {
    const raw = q.get(k);
    if (raw === null) continue;
    s[k] = typeof v === "boolean" ? raw === "1" : typeof v === "number" ? Number(raw) || 0 : raw;
  }
  return s as unknown as State;
}

function writeState(s: State) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(s)) {
    if (v !== DEFAULTS[k as keyof State]) q.set(k, typeof v === "boolean" ? (v ? "1" : "0") : String(v));
  }
  const qs = q.toString();
  history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
}

function Choice<T extends string | number>({ items, value, label, onPick }: { items: readonly T[]; value: T; label?: (t: T) => string; onPick(t: T): void }) {
  return (
    <span class="dz-choice">
      {items.map((t) => (
        <button key={t} class={t === value ? "is-on" : ""} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(t)}>
          {label ? label(t) : String(t)}
        </button>
      ))}
    </span>
  );
}

function Toggle({ on, children, onFlip }: { on: boolean; children: ComponentChildren; onFlip(): void }) {
  return (
    <button class={`dz-toggle${on ? " is-on" : ""}`} onMouseDown={(e) => e.preventDefault()} onClick={onFlip}>
      {children}
    </button>
  );
}

export function App() {
  const [s, setS] = useState(readState);
  const set = (patch: Partial<State>) => setS((old) => ({ ...old, ...patch }));
  useEffect(() => writeState(s), [s]);

  const [art, setArt] = useState<Art | null>(null);
  const [backdrop, setBackdrop] = useState<Backdrop | null>(null);
  useEffect(() => void drawArt().then(setArt), []);
  useEffect(() => {
    void drawBackdrop(TINTS[s.tint], s.theme).then(setBackdrop);
  }, [s.tint, s.theme]);

  // The stage: 1920x1080, scaled to fit the room the chrome leaves.
  const room = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  useLayoutEffect(() => {
    const el = room.current!;
    const fit = () => setScale(s.fit ? Math.min((el.clientWidth - 32) / 1920, (el.clientHeight - 32) / 1080) : 1);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [s.fit]);

  const screenRef = useRef<HTMLDivElement>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [nodes, setNodes] = useState(0);
  const [hover, setHover] = useState<Finding | null>(null);
  useEffect(() => {
    if (!s.lint) {
      setFindings([]);
      return;
    }
    const run = () => {
      const el = screenRef.current;
      if (!el) return;
      setFindings(lintTree(el, { liveGlass: s.mode === "live" }).filter((f) => s.warn || f.issues.some((i) => i.severity === "error")));
      setNodes(el.querySelectorAll("*").length);
    };
    run();
    const t = setInterval(run, 700);
    return () => clearInterval(t);
  }, [s.lint, s.warn, s.mode]);

  const props: PageProps = { mode: s.mode, theme: s.theme, backdrop, focusAll: s.focusAll };
  const page = !art ? null : s.page === "tokens" ? (
    <TokensPage {...props} />
  ) : s.page === "components" ? (
    <ComponentsPage {...props} art={art} group={s.group} />
  ) : (
    <ScreensPage {...props} art={art} screen={s.screen} />
  );

  const errors = findings.filter((f) => f.issues.some((i) => i.severity === "error")).length;

  return (
    <div class="dz">
      <header class="dz-bar">
        <b class="dz-brand">Secretary Design</b>
        <Choice items={PAGES} value={s.page} label={(p) => p[0].toUpperCase() + p.slice(1)} onPick={(page) => set({ page })} />
        {s.page === "components" && <Choice items={[0, 1, 2]} value={s.group} label={(g) => GROUPS[g]} onPick={(group) => set({ group })} />}
        {s.page === "screens" && <Choice items={SCREENS.map((_, i) => i)} value={s.screen} label={(i) => SCREENS[i]} onPick={(screen) => set({ screen })} />}
        <span class="dz-sep" />
        <Choice items={["night", "day"] as Theme[]} value={s.theme} label={(t) => (t === "day" ? "Daylight" : "Night")} onPick={(theme) => set({ theme })} />
        <Choice items={TINT_NAMES} value={s.tint} onPick={(tint) => set({ tint })} />
        <Choice items={MODES} value={s.mode} onPick={(mode) => set({ mode })} />
        <span class="dz-sep" />
        <Toggle on={s.focusAll} onFlip={() => set({ focusAll: !s.focusAll })}>Focus all</Toggle>
        <Toggle on={s.safe} onFlip={() => set({ safe: !s.safe })}>Safe area</Toggle>
        <Toggle on={s.grid} onFlip={() => set({ grid: !s.grid })}>Grid</Toggle>
        <Toggle on={s.fit} onFlip={() => set({ fit: !s.fit })}>{s.fit ? `Fit ${Math.round(scale * 100)}%` : "1:1"}</Toggle>
      </header>

      <main class="dz-room" ref={room}>
        <div class="dz-frame" style={{ width: `${1920 * scale}px`, height: `${1080 * scale}px` }}>
          <div class="dz-stage" style={{ transform: `scale(${scale})` }}>
            <div class="dz-screen" ref={screenRef}>
              {page}
            </div>
            <div class="dz-over">
              {s.grid && <div class="dz-grid" />}
              {s.safe && <div class="dz-safe" />}
              {findings.map((f, i) => (
                <Outline key={i} f={f} hot={hover === f} scale={scale} stage={screenRef.current} />
              ))}
            </div>
          </div>
        </div>
        {s.page === "screens" && SCREENS[s.screen] && !SCREENS[s.screen].startsWith("Home") && (
          <p class="dz-note">Secretary's catalog pages draw their own glass (fake, in the section's tint); the theme and mode switches apply to the home screen and the other pages.</p>
        )}
      </main>

      <aside class="dz-side">
        <section>
          <h2>
            TV rules
            <Toggle on={s.lint} onFlip={() => set({ lint: !s.lint })}>{s.lint ? "On" : "Off"}</Toggle>
            <Toggle on={s.warn} onFlip={() => set({ warn: !s.warn })}>Warnings</Toggle>
          </h2>
          {s.lint && (
            <>
              <p class="dz-sum">
                <span class={errors ? "is-bad" : "is-good"}>{errors ? `${errors} breaking` : "Nothing breaking"}</span>
                {findings.length - errors > 0 && ` · ${findings.length - errors} to check`} · {nodes} nodes
              </p>
              <ul class="dz-findings">
                {findings.map((f, i) => (
                  <li key={i} onMouseEnter={() => setHover(f)} onMouseLeave={() => setHover(null)}>
                    <code>{f.where}</code>
                    {f.issues.map((x, k) => (
                      <p key={k} class={`is-${x.severity}`}>{x.message}</p>
                    ))}
                  </li>
                ))}
              </ul>
            </>
          )}
          <p class="dz-hint">Desktop frames are not TV frames: measure changes with <code>cdp.mjs walk</code> (docs/design.md).</p>
        </section>
        <section>
          <h2>
            Remote
            <Toggle on={s.remote} onFlip={() => set({ remote: !s.remote })}>{s.remote ? "Shown" : "Hidden"}</Toggle>
          </h2>
          {s.remote && <RemotePad />}
        </section>
      </aside>
    </div>
  );
}

/** A finding's outline on the stage, in stage pixels. */
function Outline({ f, hot, scale, stage }: { f: Finding; hot: boolean; scale: number; stage: HTMLElement | null }) {
  if (!stage || !f.el.isConnected) return null;
  const r = f.el.getBoundingClientRect();
  const o = stage.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  const bad = f.issues.some((i) => i.severity === "error");
  // Warnings are outlined only while their line in the panel is hovered.
  if (!bad && !hot) return null;
  return (
    <i
      class={`dz-outline${bad ? " is-error" : ""}${hot ? " is-hot" : ""}`}
      style={{
        left: `${(r.left - o.left) / scale}px`,
        top: `${(r.top - o.top) / scale}px`,
        width: `${r.width / scale}px`,
        height: `${r.height / scale}px`,
      }}
    />
  );
}
