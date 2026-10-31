import { DEFAULT_CAPS, type DeviceCaps, parseCaps } from "@secretary/core";

// What this TV plays, as the DEVICE_CAPS list providers read (packages/plugins sandbox.ts) and the ranking uses
// (core/caps.ts): "avc,hevc,hdr10,hdr10+,4k,aac,ac3,eac3,atmos". Probed once per launch; the panel does not change
// while it runs.

/** The parts of Samsung's webapis this reads; every call may be missing or throw on an older firmware. */
interface ProbeWebapis {
  productinfo?: { isUdPanelSupported?(): boolean };
  avinfo?: { isHdrTvSupport?(): boolean };
}

export interface ProbeEnv {
  webapis?: ProbeWebapis;
  /** MediaSource.isTypeSupported, where there is one. */
  isTypeSupported?: (type: string) => boolean;
}

const ask = (f: (() => boolean | undefined) | undefined): boolean | undefined => {
  try {
    return f?.();
  } catch {
    return undefined;
  }
};

const MSE = {
  hevc: 'video/mp4; codecs="hvc1.1.6.L150.B0"',
  av1: 'video/mp4; codecs="av01.0.08M.08"',
  eac3: 'audio/mp4; codecs="ec-3"',
};

/**
 * The caps list for `env`. On a Samsung TV (webapis present) the panel answers for 4K and HDR; HDR10+ comes with HDR
 * (Samsung backs it) and Dolby Vision never does. AV1 is never listed there: MediaSource may claim it, but AVPlay,
 * which plays everything here, never leaves prepare for it (docs/lessons.md). Without webapis (a desktop preview),
 * MediaSource answers what it can; whatever nothing answers comes from the reference TV's list.
 */
export function probeCaps(env: ProbeEnv): string {
  const fallback = parseCaps(DEFAULT_CAPS);
  const caps = new Set<string>();
  const add = (cap: string, yes: boolean | undefined) => {
    if (yes ?? fallback.has(cap)) caps.add(cap);
  };
  const mse = (type: string) => (env.isTypeSupported ? ask(() => env.isTypeSupported!(type)) : undefined);
  const tv = env.webapis;
  if (tv) {
    add("avc", true);
    add("hevc", true);
    const hdr = ask(tv.avinfo?.isHdrTvSupport?.bind(tv.avinfo));
    add("hdr10", hdr);
    add("hdr10+", hdr);
    add("4k", ask(tv.productinfo?.isUdPanelSupported?.bind(tv.productinfo)));
    for (const cap of ["aac", "ac3", "eac3", "atmos"]) add(cap, true);
  } else {
    add("avc", true);
    add("hevc", mse(MSE.hevc));
    add("av1", mse(MSE.av1));
    for (const cap of ["hdr10", "hdr10+", "4k", "aac", "ac3"]) add(cap, undefined);
    add("eac3", mse(MSE.eac3));
    add("atmos", undefined);
  }
  return [...caps].join(",");
}

let cached: string | null = null;

/** This TV's caps list, probed on first use. */
export function deviceCaps(): string {
  if (cached == null) {
    const g = globalThis as { webapis?: ProbeWebapis; MediaSource?: { isTypeSupported?(t: string): boolean } };
    const isTypeSupported = g.MediaSource?.isTypeSupported?.bind(g.MediaSource);
    cached = probeCaps({ webapis: g.webapis, ...(isTypeSupported ? { isTypeSupported } : {}) });
  }
  return cached;
}

export const deviceCapSet = (): DeviceCaps => parseCaps(deviceCaps());
