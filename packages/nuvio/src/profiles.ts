import { MAX_PROFILES } from "./config.ts";
import type { NuvioClient } from "./http.ts";

export interface Profile {
  /** 1 to 6; every synced resource is scoped by it. */
  index: number;
  name: string;
  color: string;
  avatarId?: string;
  avatarUrl?: string;
  /** Shares profile 1's addons instead of keeping its own. */
  usesPrimaryAddons: boolean;
  /** Has a PIN: ask for it before switching. */
  locked: boolean;
}

interface ProfileRow {
  profile_index?: number;
  name?: string;
  avatar_color_hex?: string | null;
  avatar_id?: string | null;
  avatar_url?: string | null;
  uses_primary_addons?: boolean;
  pin_enabled?: boolean;
}

const toProfile = (r: ProfileRow): Profile | null => {
  const index = Number(r.profile_index);
  if (!Number.isInteger(index) || index < 1 || index > MAX_PROFILES) return null;
  return {
    index,
    name: r.name?.trim() || `Profile ${index}`,
    color: r.avatar_color_hex || "#1E88E5",
    avatarId: r.avatar_id || undefined,
    avatarUrl: r.avatar_url || undefined,
    usesPrimaryAddons: r.uses_primary_addons === true,
    locked: r.pin_enabled === true,
  };
};

/** The account's profiles in slot order; a new account with none yet gets a single "Main". */
export async function listProfiles(c: NuvioClient): Promise<Profile[]> {
  const rows = (await c.rpc<ProfileRow[] | null>("sync_pull_profiles")) ?? [];
  const list = rows
    .map(toProfile)
    .filter((p): p is Profile => p !== null)
    .sort((a, b) => a.index - b.index);
  return list.length
    ? list
    : [{ index: 1, name: "Main", color: "#1E88E5", usesPrimaryAddons: false, locked: false }];
}

export type PinResult = { unlocked: true } | { unlocked: false; retryAfterSec: number };

/** Checks a profile PIN on the server (an app RPC, not in the public docs); too many tries lock it for a while. */
export async function verifyPin(c: NuvioClient, index: number, pin: string): Promise<PinResult> {
  const raw = await c.rpc<unknown>("verify_profile_pin", { p_profile_id: index, p_pin: pin });
  const row = ((Array.isArray(raw) ? raw[0] : raw) ?? {}) as { unlocked?: boolean; retry_after_seconds?: number };
  if (row.unlocked === true || raw === true) return { unlocked: true };
  return { unlocked: false, retryAfterSec: Math.max(0, Number(row.retry_after_seconds) || 0) };
}

/** Avatar id to image URL, from the public avatar catalog (no session needed); empty when it fails. */
export async function avatarCatalog(c: NuvioClient): Promise<Map<string, string>> {
  try {
    const rows = (await c.rpc<{ id?: string; storage_path?: string; is_active?: boolean }[] | null>("get_avatar_catalog")) ?? [];
    const base = `${c.config.url}/storage/v1/object/public/`;
    return new Map(
      rows.flatMap((r) => {
        if (!r.id || !r.storage_path || r.is_active === false) return [];
        const path = r.storage_path.replace(/^\/+/, "");
        return [[r.id, base + (path.startsWith("avatars/") ? path : `avatars/${path}`)] as [string, string]];
      }),
    );
  } catch {
    return new Map();
  }
}

/** A custom URL, else the catalog image; undefined means "draw the colour and initial". */
export const avatarImage = (p: Pick<Profile, "avatarId" | "avatarUrl">, catalog: ReadonlyMap<string, string>) =>
  p.avatarUrl ?? (p.avatarId ? catalog.get(p.avatarId) : undefined);
