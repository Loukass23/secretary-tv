// What the TV can play, as the DEVICE_CAPS list providers also read: "avc,hevc,hdr10,hdr10+,4k,aac,ac3,eac3,atmos".
// catalog-kit/lib/device.ts probes it on the TV; everything else falls back to the reference TV's.

export type DeviceCaps = ReadonlySet<string>;

/**
 * The reference TV (a 2021 Samsung, docs/lessons.md): H.264 and HEVC, HDR10 and HDR10+, 4K, AAC, Dolby Digital (Plus)
 * and Atmos. No AV1 (AVPlay never leaves prepare), no Dolby Vision, no DTS or TrueHD passthrough.
 */
export const DEFAULT_CAPS = "avc,hevc,hdr10,hdr10+,4k,aac,ac3,eac3,atmos";

/** Commas or spaces between tokens, as providers accept either. */
export const parseCaps = (list: string): DeviceCaps =>
  new Set(
    list
      .split(/[\s,]+/)
      .map((c) => c.trim().toLowerCase())
      .filter(Boolean),
  );

export const defaultCaps: DeviceCaps = parseCaps(DEFAULT_CAPS);

/** True when the device decodes a video codec ("hevc", "av1", "h264"; any case); H.264 and an unknown one always pass. */
export function playsCodec(codec: string | null | undefined, caps: DeviceCaps = defaultCaps): boolean {
  const c = codec?.toLowerCase();
  return !(c === "av1" || c === "hevc") || caps.has(c);
}
