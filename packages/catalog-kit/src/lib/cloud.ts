// The catalog apps' Nuvio Cloud side (docs/nuvio-cloud.md): the session Nest hands over at launch, and watch
// progress and watched history synced with the profile it names.
import {
  addToLibrary,
  createClient,
  deleteProgress,
  listCounts,
  deleteWatched,
  type LaunchPayload,
  nuvioConfig,
  progressKey,
  pullAddons,
  pullCollections,
  pullLibrary,
  pullPlugins,
  pullProgress,
  pullWatched,
  pushAddons,
  pushPlugins,
  pushProgress,
  pushWatched,
  readLaunch,
  removeFromLibrary,
  sharesPrimary,
  toItems,
  toRow,
  watchedTitleIds,
  withMeta,
} from "@secretary/nuvio";
import { createPartyApi } from "@secretary/party/src/client.ts";
import { readJson, writeJson } from "@secretary/tv-kit";
import type { CatalogType, Title, Video } from "./types.ts";
import { manifestUrl } from "@secretary/plugins";
import { addonManifestUrl } from "./addons.ts";
import type { LibraryEntry, LibraryRemote } from "./library.ts";
import type { CollectionsRemote } from "./nuviocollections.ts";
import { createListSync, type ListSide } from "./listsync.ts";
import type { ResumeRemote, UnifiedResumeEntry } from "./resume.ts";

declare const __NUVIO_URL__: string | undefined;
declare const __NUVIO_KEY__: string | undefined;
declare const __SYNC_BACKEND__: string | undefined;
declare const __PARTY_URL__: string | undefined;

const kv = { get: readJson, set: writeJson };

export const cloud = createClient({
  config: nuvioConfig(
    typeof __NUVIO_URL__ !== "undefined" ? __NUVIO_URL__ : "",
    typeof __NUVIO_KEY__ !== "undefined" ? __NUVIO_KEY__ : "",
  ),
  kv,
});

/** Watch together (docs/watch-party.md): rooms on the party Worker, as the signed-in Nuvio profile. */
export const partyApi = createPartyApi({
  url: typeof __PARTY_URL__ !== "undefined" ? __PARTY_URL__ : "",
  token: () => cloud.token(),
});

/** "secretary" builds keep the home server as the only backend (dev and tests). */
export const cloudEnabled = !(typeof __SYNC_BACKEND__ !== "undefined" && __SYNC_BACKEND__ === "secretary");

const LAUNCH_AT = "sectv.nuvio.launchAt";
const OWNER = "sectv.nuvio.owner";

/** The account and profile this app's local lists belong to. */
export const owner = () => {
  const s = cloud.session.get();
  return s && !s.anonymous ? `${s.userId}:${cloud.session.profile()}` : null;
};

/**
 * Applies Nest's launch payload once: a session for another account or profile replaces this app's, and the local
 * lists of the previous one are dropped (through `onOwnerChange`). Returns the title Nest asked to open.
 */
export function takeLaunch(onOwnerChange: () => void, read: () => LaunchPayload | null = readLaunch): LaunchPayload["open"] | null {
  const p = read();
  if (!p || p.at <= (readJson<number>(LAUNCH_AT) ?? 0)) return null;
  writeJson(LAUNCH_AT, p.at);
  if (p.grant && cloudEnabled) {
    const next = `${p.grant.session.userId}:${p.grant.profile}`;
    if (owner() !== next) {
      cloud.session.set(p.grant.session);
      cloud.session.setProfile(p.grant.profile);
    }
  }
  const now = owner();
  if (now !== readJson<string>(OWNER)) {
    writeJson(OWNER, now);
    onOwnerChange();
  }
  return p.open ?? null;
}

const contentType = (type: CatalogType) => (type === "movie" ? "movie" : "series");

/** Resume and watched sync with the signed-in profile; every call fails soft (the lists stay local). */
export function nuvioRemote(appType: CatalogType): ResumeRemote {
  const live = () => cloudEnabled && cloud.session.signedIn();
  const profile = () => cloud.session.profile();
  return {
    async pull(known) {
      if (!live()) return null;
      try {
        const items = toItems(await pullProgress(cloud, profile()), known);
        return (await withMeta(items, kv)) as UnifiedResumeEntry[];
      } catch {
        return null;
      }
    },
    async push(entries) {
      if (!live()) return false;
      try {
        await pushProgress(cloud, profile(), entries.map(toRow));
        return true;
      } catch {
        return false;
      }
    },
    async finished(type: CatalogType, title: Title, episode?: Pick<Video, "season" | "episode">) {
      if (!live()) return;
      try {
        await pushWatched(cloud, profile(), [
          {
            content_id: title.id,
            content_type: contentType(type),
            title: title.name,
            ...(episode ? { season: episode.season, episode: episode.episode } : {}),
            watched_at: Date.now(),
          },
        ]);
        await deleteProgress(cloud, profile(), [progressKey(title.id, episode?.season, episode?.episode)]);
      } catch {
        // The next sync pushes the local state again.
      }
    },
    async watched(id: string, watched: boolean) {
      if (!live()) return;
      try {
        if (watched) {
          await pushWatched(cloud, profile(), [{ content_id: id, content_type: contentType(appType), watched_at: Date.now() }]);
        } else {
          await deleteWatched(cloud, profile(), [{ content_id: id }]);
        }
      } catch {
        // Kept locally.
      }
    },
    async pullWatched() {
      if (!live()) return null;
      try {
        return watchedTitleIds(await pullWatched(cloud, profile()));
      } catch {
        return null;
      }
    },
  };
}

/** A stable id for this app on this TV, attached to library changes so other devices can tell where they came from. */
function installId(): string {
  const key = "sectv.nuvio.installId";
  let id = readJson<string>(key);
  if (!id) {
    id = `secretary-tv-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
    writeJson(key, id);
  }
  return id;
}

/** My List synced with the profile's library; changes go in the order they were made. */
export function nuvioLibrary(): LibraryRemote {
  const live = () => cloudEnabled && cloud.session.signedIn();
  return {
    async pull() {
      if (!live()) return null;
      try {
        return (await pullLibrary(cloud, cloud.session.profile())) as LibraryEntry[];
      } catch {
        return null;
      }
    },
    async apply(changes) {
      if (!live()) return false;
      const p = cloud.session.profile();
      try {
        for (const c of changes) {
          if (c.op === "add") await addToLibrary(cloud, p, [c.entry], installId());
          else await removeFromLibrary(cloud, p, [{ type: c.type, title: { id: c.id, name: "", year: "", rating: "" } }], installId());
        }
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** The profile's collections (lib/nuviocollections.ts), read only: editing stays on nuvio.tv. */
export function nuvioCollections(): CollectionsRemote {
  return {
    owner,
    async pull() {
      if (!cloudEnabled || !cloud.session.signedIn()) return null;
      try {
        return (await pullCollections(cloud, cloud.session.profile()))?.collections ?? null;
      } catch {
        return null;
      }
    },
  };
}

/**
 * Plugin repositories and addons kept the same as the profile's lists on Nuvio Cloud (lib/listsync.ts). A profile
 * set to use profile 1's lists reads them and never writes them.
 */
export function startListSync(plugins: ListSide, addons: ListSide): { sync(): Promise<void> } {
  const live = () => cloudEnabled && cloud.session.signedIn();
  let share = { addons: false, plugins: false };
  let foreign: Awaited<ReturnType<typeof pullPlugins>>["foreign"] = [];
  const pluginSync = createListSync({
    key: "sectv.nuvio.pluginSync",
    side: plugins,
    kv,
    normalize: manifestUrl,
    cloud: {
      owner,
      readOnly: () => share.plugins,
      async pull() {
        if (!live()) return null;
        try {
          share = await sharesPrimary(cloud, cloud.session.profile());
          const got = await pullPlugins(cloud, share.plugins ? 1 : cloud.session.profile());
          foreign = got.foreign;
          return got.rows;
        } catch {
          return null;
        }
      },
      async push(rows) {
        try {
          await pushPlugins(cloud, cloud.session.profile(), rows, foreign, installId());
          return true;
        } catch {
          return false;
        }
      },
      count: async () => (await listCounts(cloud, cloud.session.profile()))?.plugins ?? null,
    },
  });
  const addonSync = createListSync({
    key: "sectv.nuvio.addonSync",
    side: addons,
    kv,
    normalize: (u) => {
      try {
        return addonManifestUrl(u);
      } catch {
        return u;
      }
    },
    cloud: {
      owner,
      readOnly: () => share.addons,
      async pull() {
        if (!live()) return null;
        try {
          return await pullAddons(cloud, share.addons ? 1 : cloud.session.profile());
        } catch {
          return null;
        }
      },
      async push(rows) {
        try {
          await pushAddons(cloud, cloud.session.profile(), rows, installId());
          return true;
        } catch {
          return false;
        }
      },
      count: async () => (await listCounts(cloud, cloud.session.profile()))?.addons ?? null,
    },
  });
  // Plugins first: their pull learns whether the profile shares profile 1's lists.
  return { sync: () => pluginSync.sync().then(() => addonSync.sync()) };
}
