import { DEBRID_LABELS, type DebridId } from "@secretary/core";
import type { PluginState } from "@secretary/plugins";
import type { AddonState } from "../lib/addons.ts";
import type { DebridSettings } from "../lib/plugins.ts";

/** One row of Settings › Sources: a glass list card, and what OK (and Left/Right) does on it. */
export interface SourceRow {
  key: string;
  title: string;
  sub: string;
  meta: string;
  action:
    | { kind: "plugins" }
    | { kind: "repo"; url: string }
    | { kind: "scraper"; url: string; id: string }
    | { kind: "remove"; url: string }
    | { kind: "add" }
    | { kind: "refresh" }
    | { kind: "key"; service: DebridId }
    | { kind: "order" }
    | { kind: "torboxAhead" }
    | { kind: "addon"; url: string }
    | { kind: "addonRemove"; url: string }
    | { kind: "addonAdd" }
    | { kind: "addonRefresh" };
}

const onOff = (on: boolean) => (on ? "On" : "Off");
const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};
/** A key is shown by its last four characters only. */
const masked = (key?: string) => (key ? `•••• ${key.slice(-4)}` : "Not set");

/**
 * The Sources part of Settings, two levels deep but flat on screen: plugins on or off,
 * each repository with its providers under it, adding a repository, then the debrid keys and which one goes first.
 * `confirm` is the repository whose Remove row was pressed once.
 */
export function sourceRows(
  state: PluginState,
  isOn: (url: string, id: string) => boolean,
  debrid: DebridSettings,
  confirm: string | null,
  /** Provider ids in the user's order (lib/rules.ts): autoplay prefers the earlier ones among equal sources. */
  providerOrder: readonly string[] = [],
): SourceRow[] {
  const rows: SourceRow[] = [
    {
      key: "plugins",
      title: "Nuvio plugins",
      sub: "Sources · Find streams with plugin repositories on this TV",
      meta: onOff(state.enabled),
      action: { kind: "plugins" },
    },
  ];
  if (state.enabled) {
    for (const r of state.repos) {
      const n = r.manifest?.scrapers.length ?? 0;
      rows.push({
        key: `repo:${r.url}`,
        title: r.manifest?.name ?? host(r.url),
        sub: `Repository · ${host(r.url)} · ${n} provider${n === 1 ? "" : "s"}${r.error ? ` · last read failed: ${r.error}` : ""}`,
        meta: onOff(r.enabled),
        action: { kind: "repo", url: r.url },
      });
      if (!r.enabled) continue;
      for (const s of r.manifest?.scrapers ?? []) {
        rows.push({
          key: `scraper:${r.url}:${s.id}`,
          title: `   ${s.name}`,
          sub: `Provider · #${providerOrder.indexOf(s.id) + 1} in order, ‹ › moves it · ${s.description || s.supportedTypes.join(", ") || s.id}`,
          meta: onOff(isOn(r.url, s.id)),
          action: { kind: "scraper", url: r.url, id: s.id },
        });
      }
      rows.push({
        key: `remove:${r.url}`,
        title: `   Remove ${r.manifest?.name ?? host(r.url)}`,
        sub: confirm === r.url ? "Press OK again to remove it" : "Repository · Takes it and its providers off this TV",
        meta: confirm === r.url ? "Confirm" : "OK",
        action: { kind: "remove", url: r.url },
      });
    }
    rows.push(
      {
        key: "add",
        title: "Add a repository",
        sub: "Sources · Type the manifest URL of a Nuvio plugin repository",
        meta: "OK",
        action: { kind: "add" },
      },
      {
        key: "refresh",
        title: "Read repositories again",
        sub: "Sources · They are read every six hours; this reads them now",
        meta: "OK",
        action: { kind: "refresh" },
      },
    );
  }
  for (const service of ["tb", "pm"] as const) {
    rows.push({
      key: `key:${service}`,
      title: `${DEBRID_LABELS[service]} key`,
      sub: "Debrid · Plays cached torrents from plugins; stored on this TV only",
      meta: masked(debrid.keys[service]),
      action: { kind: "key", service },
    });
  }
  rows.push({
    key: "order",
    title: "Debrid order",
    sub: "Debrid · A torrent plays from the first service that has it cached",
    meta: `‹ ${debrid.order.map((s) => DEBRID_LABELS[s]).join(" first, then ")} ›`,
    action: { kind: "order" },
  });
  rows.push({
    key: "torboxAhead",
    title: "Check TorBox sources ahead",
    sub: "Debrid · Faster failover, but TorBox adds each checked torrent to your account",
    meta: onOff(Boolean(debrid.torboxAhead)),
    action: { kind: "torboxAhead" },
  });
  return rows;
}

/** What an addon gives, from its manifest: "Streams, subtitles · movie, series · 3 catalogs". */
function addonSummary(a: AddonState): string {
  const m = a.manifest;
  if (!m) return "Not read yet";
  const names: Record<string, string> = { stream: "streams", subtitles: "subtitles", meta: "details", catalog: "catalogs" };
  const gives = [...new Set(m.resources.map((r) => names[typeof r === "string" ? r : r.name]).filter(Boolean))].join(", ");
  return `${gives || "nothing this app uses"} · ${m.types.join(", ") || "no types"}${m.catalogs.length ? ` · ${m.catalogs.length} rows` : ""}`;
}

/**
 * Settings › Addons: each installed Stremio addon (OK turns it on or off, ‹ › moves it in the order) with its Remove
 * row, then installing one and reading them again. `confirm` is the addon whose Remove row was pressed once.
 */
export function addonRows(list: readonly AddonState[], confirm: string | null): SourceRow[] {
  const rows: SourceRow[] = [];
  list.forEach((a, i) => {
    rows.push({
      key: `addon:${a.url}`,
      title: a.name,
      sub: `Addon · #${i + 1} in order, ‹ › moves it · ${host(a.url)} · ${addonSummary(a)}${a.error ? ` · last read failed: ${a.error}` : ""}`,
      meta: onOff(a.enabled),
      action: { kind: "addon", url: a.url },
    });
    rows.push({
      key: `addonRemove:${a.url}`,
      title: `   Remove ${a.name}`,
      sub: confirm === a.url ? "Press OK again to remove it" : "Addon · Takes it off this TV",
      meta: confirm === a.url ? "Confirm" : "OK",
      action: { kind: "addonRemove", url: a.url },
    });
  });
  rows.push(
    {
      key: "addonAdd",
      title: "Install an addon",
      sub: "Addons · Type the manifest URL of a Stremio addon",
      meta: "OK",
      action: { kind: "addonAdd" },
    },
    {
      key: "addonRefresh",
      title: "Read addons again",
      sub: "Addons · They are read every six hours; this reads them now",
      meta: "OK",
      action: { kind: "addonRefresh" },
    },
  );
  return rows;
}
