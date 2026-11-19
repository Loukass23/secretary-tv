// The TV rules as a linter over computed styles (docs/design.md). The rules come from measurements on the
// reference TV (docs/performance.md, glass lab; docs/lessons.md): what costs long frames there costs nothing
// on a desktop, so the workbench points it out instead. `lintStyle` is pure and tested; `lintTree` walks the DOM.

export type Severity = "error" | "warn";

export type RuleId = "backdrop-filter" | "soft-shadow" | "css-gradient" | "filter-blur" | "animated-layout" | "no-layer";

export interface Issue {
  rule: RuleId;
  severity: Severity;
  message: string;
}

/** The computed properties the rules read (a CSSStyleDeclaration has them all). */
export interface StyleLike {
  backdropFilter?: string;
  boxShadow?: string;
  backgroundImage?: string;
  filter?: string;
  transitionProperty?: string;
  transitionDuration?: string;
  animationName?: string;
  animationDuration?: string;
  willChange?: string;
  /** The element's own (inline) transform: a translate3d there already gives it a layer, which computed styles hide. */
  inlineTransform?: string;
}

export interface LintOptions {
  /** The "live" glass mode is the measured bad case and may use backdrop-filter. */
  liveGlass?: boolean;
  /** Properties each @keyframes rule animates, by name. */
  keyframes?: ReadonlyMap<string, ReadonlySet<string>>;
}

/** An outer shadow blurred more than this repaints too much on the TV; hairlines and rings (blur 0) are fine. */
export const MAX_SHADOW_BLUR = 8;

/** Properties that must not animate: they relayout or repaint. Only transform and opacity move. */
const COSTLY = new Set([
  "width", "height", "min-width", "min-height", "max-width", "max-height",
  "top", "left", "right", "bottom", "inset",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "font-size", "line-height", "border-width", "border-radius",
  "filter", "backdrop-filter", "box-shadow", "background-position", "background-size",
]);

/** Splits a CSS list on top-level commas (not the ones inside rgba(...)). */
export function splitList(v: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of v) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** "0.28s" or "180ms" in ms. */
export function durationMs(v: string): number {
  const n = parseFloat(v);
  if (Number.isNaN(n)) return 0;
  return v.trim().endsWith("ms") ? n : n * 1000;
}

export interface Shadow {
  inset: boolean;
  blur: number;
  spread: number;
}

/** Parses a computed box-shadow ("rgba(0, 0, 0, 0.5) 0px 18px 40px 0px, ... inset"). */
export function parseShadows(v: string | undefined): Shadow[] {
  if (!v || v === "none") return [];
  return splitList(v).map((s) => {
    const lengths = (s.replace(/\([^)]*\)/g, "").match(/-?[\d.]+px|\b0\b/g) ?? []).map((x) => parseFloat(x));
    return { inset: /\binset\b/.test(s), blur: lengths[2] ?? 0, spread: lengths[3] ?? 0 };
  });
}

/** Each animated property with its duration (CSS repeats the shorter list to match the longer). */
function transitions(s: StyleLike): { prop: string; ms: number }[] {
  const props = splitList(s.transitionProperty ?? "");
  const times = splitList(s.transitionDuration ?? "0s");
  return props.map((prop, i) => ({ prop, ms: durationMs(times[i % times.length] ?? "0s") }));
}

export function lintStyle(s: StyleLike, opts: LintOptions = {}): Issue[] {
  const out: Issue[] = [];
  if (s.backdropFilter && s.backdropFilter !== "none" && !opts.liveGlass) {
    out.push({
      rule: "backdrop-filter",
      severity: "error",
      message: `backdrop-filter: ${s.backdropFilter}. A live blur drops the TV to about 15 fps; use the frost (GlassRoot mode="fake").`,
    });
  }
  for (const sh of parseShadows(s.boxShadow)) {
    if (!sh.inset && sh.blur > MAX_SHADOW_BLUR) {
      out.push({
        rule: "soft-shadow",
        severity: "error",
        message: `Outer shadow blurred ${sh.blur}px. Soft shadows cost 16-20 long frames per walk; use an inset hairline or a Glow.`,
      });
      break;
    }
  }
  if (s.backgroundImage && /gradient\(/.test(s.backgroundImage)) {
    out.push({
      rule: "css-gradient",
      severity: "error",
      message: "CSS gradient. Gradients are the slowest fill on the TV; paint it once on a canvas (wallpaper.ts) or use a flat fill.",
    });
  }
  if (s.filter && /blur\(/.test(s.filter)) {
    out.push({ rule: "filter-blur", severity: "error", message: `filter: ${s.filter}. Blur once on a canvas instead (backdrop.ts).` });
  }
  const moving = transitions(s).filter((t) => t.ms > 0);
  const costly = moving.filter((t) => COSTLY.has(t.prop)).map((t) => t.prop);
  if (costly.length) {
    out.push({
      rule: "animated-layout",
      severity: "error",
      message: `Transition on ${costly.join(", ")}. Animate transform and opacity only.`,
    });
  }
  if (moving.some((t) => t.prop === "all")) {
    out.push({ rule: "animated-layout", severity: "warn", message: "transition: all can animate layout. Name transform and/or opacity." });
  }
  for (const name of splitList(s.animationName ?? "none")) {
    if (name === "none") continue;
    const props = [...(opts.keyframes?.get(name) ?? [])].filter((p) => COSTLY.has(p));
    if (props.length) {
      out.push({ rule: "animated-layout", severity: "error", message: `@keyframes ${name} animates ${props.join(", ")}.` });
    }
  }
  const layered = s.willChange ?? "auto";
  const own3d = /3d\(/.test(s.inlineTransform ?? "");
  const unlayered = own3d
    ? []
    : moving.map((t) => t.prop).filter((p) => (p === "transform" || p === "opacity") && !layered.includes(p) && !layered.includes("transform"));
  if (unlayered.length) {
    out.push({
      rule: "no-layer",
      severity: "warn",
      message: `Animates ${unlayered.join(", ")} without will-change. Moving and fading elements go on their own layer.`,
    });
  }
  return out;
}

export interface Finding {
  el: Element;
  pseudo: "" | "::before" | "::after";
  /** "div.sg-card.is-focus::before" */
  where: string;
  issues: Issue[];
}

/** Properties each @keyframes rule in the page animates. */
export function keyframeProps(doc: Document): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const sheet of Array.from(doc.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // cross-origin sheet
    }
    for (const r of Array.from(rules)) {
      if (!(r instanceof CSSKeyframesRule)) continue;
      const props = out.get(r.name) ?? new Set<string>();
      for (const f of Array.from(r.cssRules) as CSSKeyframeRule[]) {
        for (let i = 0; i < f.style.length; i++) props.add(f.style[i]);
      }
      out.set(r.name, props);
    }
  }
  return out;
}

const pick = (s: CSSStyleDeclaration): StyleLike => ({
  backdropFilter: s.backdropFilter,
  boxShadow: s.boxShadow,
  backgroundImage: s.backgroundImage,
  filter: s.filter,
  transitionProperty: s.transitionProperty,
  transitionDuration: s.transitionDuration,
  animationName: s.animationName,
  animationDuration: s.animationDuration,
  willChange: s.willChange,
});

const describe = (el: Element) =>
  el.tagName.toLowerCase() + Array.from(el.classList).slice(0, 3).map((c) => `.${c}`).join("");

/** Lints `root` and everything in it, pseudo-elements included. */
export function lintTree(root: Element, opts: Omit<LintOptions, "keyframes"> = {}): Finding[] {
  const keyframes = keyframeProps(root.ownerDocument);
  const out: Finding[] = [];
  const win = root.ownerDocument.defaultView!;
  for (const el of [root, ...Array.from(root.querySelectorAll("*"))]) {
    for (const pseudo of ["", "::before", "::after"] as const) {
      const s = win.getComputedStyle(el, pseudo || null);
      if (pseudo && (s.content === "none" || s.content === "normal")) continue;
      const inlineTransform = pseudo ? undefined : (el as HTMLElement).style?.transform;
      const issues = lintStyle({ ...pick(s), inlineTransform }, { ...opts, keyframes });
      if (issues.length) out.push({ el, pseudo, where: describe(el) + pseudo, issues });
    }
  }
  return out;
}
