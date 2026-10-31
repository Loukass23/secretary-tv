export interface NuvioConfig {
  /** The Supabase-compatible API, without a trailing slash. */
  url: string;
  /** The publishable key every auth/v1 and rest/v1 request carries. */
  key: string;
}

/** Nuvio publishes this key at nuvio.tv/docs for public clients; it is not a secret. */
export const NUVIO_CLOUD: NuvioConfig = {
  url: "https://api.nuvio.tv",
  key: "sb_publishable_1Clq8rlTVACkdcZuqr6_AD__xUUC_EN",
};

/** The page a phone opens from the TV's QR code. */
export const TV_LOGIN_BASE = "https://nuvio.tv/tv-login";

/** Current Nuvio clients understand six profile slots. */
export const MAX_PROFILES = 6;

/** A build's own values (from its env) over the public defaults. */
export function nuvioConfig(url?: string, key?: string): NuvioConfig {
  return { url: (url || NUVIO_CLOUD.url).replace(/\/+$/, ""), key: key || NUVIO_CLOUD.key };
}
