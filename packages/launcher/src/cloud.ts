// Nest's Nuvio Cloud account (docs/nuvio-cloud.md): the signed-in session lives here, and each catalog app gets a
// session of its own when Nest launches it, through the app-control payload.
import { createClient, encodeLaunch, LAUNCH_KEY, mintAppSession, nuvioConfig, type OpenTitle } from "@secretary/nuvio";
import { createPartyApi } from "@secretary/party/src/client.ts";
import { readJson, writeJson } from "@secretary/tv-kit";
import { NUVIO_KEY, NUVIO_URL, PARTY_URL, SYNC_BACKEND } from "./config.ts";

export const cloud = createClient({ config: nuvioConfig(NUVIO_URL, NUVIO_KEY), kv: { get: readJson, set: writeJson } });

export const cloudEnabled = SYNC_BACKEND === "nuvio";

/** Watch together: Nest only looks a code up; the catalog app it opens joins the room. */
export const partyApi = createPartyApi({ url: PARTY_URL, token: () => cloud.token() });

/**
 * Which account and profile each app was last given, and the app's install time then, so a grant goes once, not on
 * every launch. Records from before the install time are plain `user:profile` strings.
 */
const GRANTS = "sectv.nuvio.grants";

export interface Grant {
  owner: string;
  /** The app's install time (epoch ms) when it got the session, or null when Tizen did not say. */
  installed: number | null;
}
type Grants = Record<string, Grant | string>;
/** The user chose "Not now" on the first-run sign-in. */
const SKIPPED = "sectv.nuvio.skipped";

export const grantKey = (userId: string, profile: number) => `${userId}:${profile}`;

export const signInSkipped = () => readJson<boolean>(SKIPPED) === true;
export const skipSignIn = () => writeJson(SKIPPED, true);

/** Forget every grant (sign-out, another account): the apps get a fresh session on their next launch. */
export const resetGrants = () => writeJson(GRANTS, {});

/**
 * Whether an app needs a session from Nest: signed in, and the app has not been given this account and profile yet,
 * or it was installed again since (a reinstall wipes its storage, session included). An unknown install time keeps
 * the grant; a record without one is from before this rule and is replaced once. Pure on its inputs so it can be
 * tested.
 */
export function needsGrant(grant: Grant | string | undefined, current: string | null, installed: number | null): boolean {
  if (current === null || grant === undefined) return current !== null;
  if (typeof grant === "string") return grant !== current || installed !== null;
  return grant.owner !== current || (installed !== null && grant.installed !== installed);
}

type TizenApp = {
  getAppInfo(id: string): { installDate?: Date };
  launchAppControl(ctl: unknown, id: string, ok?: () => void, err?: (e: unknown) => void): void;
};
type TizenNs = {
  application?: TizenApp;
  ApplicationControl?: new (op: string, uri: null, mime: null, cat: null, data: unknown[]) => unknown;
  ApplicationControlData?: new (key: string, value: string[]) => unknown;
};

/** When `id` was last installed (epoch ms), or null off the TV or when Tizen does not say. */
function installedAt(id: string): number | null {
  try {
    const t = (globalThis as { tizen?: TizenNs }).tizen?.application?.getAppInfo(id).installDate?.getTime();
    return typeof t === "number" && Number.isFinite(t) ? t : null;
  } catch {
    return null;
  }
}

function launchWithData(id: string, value: string): Promise<void> {
  const t = (globalThis as { tizen?: TizenNs }).tizen;
  return new Promise((resolve, reject) => {
    if (!t?.application || !t.ApplicationControl || !t.ApplicationControlData) {
      return reject(new Error("tizen.application unavailable"));
    }
    const data = [new t.ApplicationControlData(LAUNCH_KEY, [value])];
    const ctl = new t.ApplicationControl("http://tizen.org/appcontrol/operation/default", null, null, null, data);
    t.application.launchAppControl(ctl, id, () => resolve(), reject);
  });
}

/**
 * Launches a catalog app with what it needs from Nest: a session of its own when it has none for this account and
 * profile yet, and the title to open. Without Nuvio (or signed out) it is a plain launch with the title only.
 */
export async function launchCatalogApp(
  id: string,
  open: OpenTitle | undefined,
  fallback: (id: string) => Promise<void>,
): Promise<void> {
  const s = cloud.session.get();
  const current = cloudEnabled && s && !s.anonymous ? grantKey(s.userId, cloud.session.profile()) : null;
  const grants = readJson<Grants>(GRANTS) ?? {};
  const installed = installedAt(id);
  let grant: { session: NonNullable<typeof s>; profile: number } | undefined;
  if (needsGrant(grants[id], current, installed)) {
    try {
      grant = { session: await mintAppSession(cloud, { deviceName: "Secretary TV" }), profile: cloud.session.profile() };
    } catch (e) {
      // Launch anyway; the app works signed out and gets a session on a later launch.
      console.warn("[nest] app session failed", e);
    }
  }
  if (!grant && !open) return fallback(id);
  await launchWithData(id, encodeLaunch({ at: Date.now(), grant, open }));
  if (grant && current) writeJson(GRANTS, { ...grants, [id]: { owner: current, installed } satisfies Grant });
}
