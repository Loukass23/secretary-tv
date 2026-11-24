// Secretary's Nuvio Cloud account (docs/nuvio-cloud.md): the signed-in session lives here, and the embedded catalog
// uses this same client (catalog-host.tsx).
import { createClient, nuvioConfig } from "@secretary/nuvio";
import { createPartyApi } from "@secretary/party/src/client.ts";
import { readJson, writeJson } from "@secretary/tv-kit";
import { NUVIO_KEY, NUVIO_URL, PARTY_URL, SYNC_BACKEND } from "./config.ts";

export const cloud = createClient({ config: nuvioConfig(NUVIO_URL, NUVIO_KEY), kv: { get: readJson, set: writeJson } });

export const cloudEnabled = SYNC_BACKEND === "nuvio";

/** Watch together: Secretary looks a code up, and its embedded catalog joins the room. */
export const partyApi = createPartyApi({ url: PARTY_URL, token: () => cloud.token() });

/** The user chose "Not now" on the first-run sign-in. */
const SKIPPED = "sectv.nuvio.skipped";

export const signInSkipped = () => readJson<boolean>(SKIPPED) === true;
export const skipSignIn = () => writeJson(SKIPPED, true);
