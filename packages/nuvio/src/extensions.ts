import type { NuvioClient } from "./http.ts";

// Addons and plugin repositories of a profile (docs/nuvio-cloud.md). Both are full-replace lists on the server: a
// push deletes every row it leaves out, so a client always sends the whole list.

/** One addon or plugin repository as the lists carry it. */
export interface ListRow {
  url: string;
  name: string;
  enabled: boolean;
  sort_order: number;
}

interface PluginRow extends ListRow {
  /** NUVIO_JS: the scraper repositories this TV runs; other kinds (Android DEX) belong to other apps. */
  repo_type?: string | null;
}

const asRow = (r: Partial<ListRow>, i: number): ListRow => ({
  url: String(r.url ?? ""),
  name: r.name ?? "",
  enabled: r.enabled !== false,
  sort_order: typeof r.sort_order === "number" ? r.sort_order : i,
});

export async function pullAddons(c: NuvioClient, profile: number): Promise<ListRow[]> {
  const rows = (await c.table<Partial<ListRow>[]>(`addons?select=url,name,enabled,sort_order&profile_id=eq.${profile}&order=sort_order.asc`)) ?? [];
  return rows.map(asRow).filter((r) => r.url);
}

export async function pushAddons(c: NuvioClient, profile: number, rows: readonly ListRow[], origin?: string): Promise<void> {
  await c.rpc("sync_push_addons", { p_profile_id: profile, p_addons: rows, ...(origin ? { p_origin_client_id: origin } : {}) });
}

/** The profile's plugin repositories: ours (NUVIO_JS) and the rows of other kinds, kept to be sent back as they are. */
export async function pullPlugins(c: NuvioClient, profile: number): Promise<{ rows: ListRow[]; foreign: PluginRow[] }> {
  const raw = (await c.table<PluginRow[]>(`plugins?select=url,name,enabled,sort_order,repo_type&profile_id=eq.${profile}&order=sort_order.asc`)) ?? [];
  const ours = (r: PluginRow) => (r.repo_type ?? "NUVIO_JS") === "NUVIO_JS" && !/\.cs3(\?|$)/i.test(r.url ?? "");
  return {
    rows: raw.filter(ours).map(asRow).filter((r) => r.url),
    foreign: raw.filter((r) => !ours(r)),
  };
}

export async function pushPlugins(
  c: NuvioClient,
  profile: number,
  rows: readonly ListRow[],
  foreign: readonly PluginRow[] = [],
  origin?: string,
): Promise<void> {
  const all = [
    ...rows.map((r) => ({ ...r, repo_type: "NUVIO_JS" })),
    ...foreign.map((r, i) => ({ ...r, sort_order: rows.length + i })),
  ];
  await c.rpc("sync_push_plugins", { p_profile_id: profile, p_plugins: all, ...(origin ? { p_origin_client_id: origin } : {}) });
}

/** How many addons and plugins the server holds for a profile (to confirm an empty list before acting on it). */
export async function listCounts(c: NuvioClient, profile: number): Promise<{ addons: number; plugins: number } | null> {
  try {
    const o = await c.rpc<{ addons?: Record<string, number>; plugins?: Record<string, number> }>("get_sync_overview");
    return { addons: o?.addons?.[String(profile)] ?? 0, plugins: o?.plugins?.[String(profile)] ?? 0 };
  } catch {
    return null;
  }
}

/** Whether a profile uses profile 1's addons or plugins instead of its own. */
export async function sharesPrimary(c: NuvioClient, profile: number): Promise<{ addons: boolean; plugins: boolean }> {
  if (profile === 1) return { addons: false, plugins: false };
  try {
    const [p] =
      (await c.table<{ uses_primary_addons?: boolean; uses_primary_plugins?: boolean }[]>(
        `profiles?select=uses_primary_addons,uses_primary_plugins&profile_index=eq.${profile}`,
      )) ?? [];
    return { addons: p?.uses_primary_addons === true, plugins: p?.uses_primary_plugins === true };
  } catch {
    return { addons: false, plugins: false };
  }
}
