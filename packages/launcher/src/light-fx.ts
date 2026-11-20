// Nest's light effects, set in the Lights panel: the splash, the poster-coloured background, and the side lights
// following that colour. One master switch turns every one of them off.
export interface LightFx {
  /** Master switch: off, none of the effects below run (the opening ripple included). */
  enabled: boolean;
  /** The splash plays the secretary bird and the warm side lights when Nest opens, and the lights fade out as it is left. */
  splash: boolean;
  /** The background takes the mood of the focused poster. */
  mood: boolean;
  /** The side lights take the same colour (needs SmartThings; off until chosen, so a room never changes unasked). */
  sync: boolean;
  /** Music mode makes the side lights dance through colours. */
  dance: boolean;
  /** Slow metallic light slides across the background. */
  shimmer: boolean;
}

export const LIGHT_FX_DEFAULT: LightFx = { enabled: true, splash: true, mood: true, sync: false, dance: true, shimmer: true };

export const LIGHT_FX_KEY = "nest.lightFx";

/** Reads stored settings of any shape: a wrong type falls back to the default for that field. */
export function parseLightFx(raw: unknown): LightFx {
  const v = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const pick = (k: keyof LightFx) => (typeof v[k] === "boolean" ? (v[k] as boolean) : LIGHT_FX_DEFAULT[k]);
  return { enabled: pick("enabled"), splash: pick("splash"), mood: pick("mood"), sync: pick("sync"), dance: pick("dance"), shimmer: pick("shimmer") };
}

/** What each effect actually does once the master switch is counted. */
export function effective(fx: LightFx): LightFx {
  return fx.enabled ? fx : { enabled: false, splash: false, mood: false, sync: false, dance: false, shimmer: false };
}

const listeners = new Set<(fx: LightFx) => void>();

export function lightFx(): LightFx {
  try {
    return parseLightFx(JSON.parse(localStorage.getItem(LIGHT_FX_KEY) ?? "null"));
  } catch {
    return LIGHT_FX_DEFAULT;
  }
}

export function setLightFx(patch: Partial<LightFx>): LightFx {
  const next = { ...lightFx(), ...patch };
  try {
    localStorage.setItem(LIGHT_FX_KEY, JSON.stringify(next));
  } catch {
    // Until Nest restarts.
  }
  listeners.forEach((l) => l(next));
  return next;
}

/** Calls `cb` whenever the settings change; returns the way to stop. */
export function onLightFx(cb: (fx: LightFx) => void): () => void {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}
