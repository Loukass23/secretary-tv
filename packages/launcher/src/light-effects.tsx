// The light effects (light-fx.ts) as Settings › SmartThings and the Mood panel show them: their names, what each does,
// and a little room previewing it, a screen between two side lights, lamps by opacity and the shimmer by transform, on
// their own layers (style.css .lfx-*).
import type { LightFx } from "./light-fx.ts";

/** The light effects: each OK flips one. Turning "Light effects" off stops every other one, whatever it is set to. */
export const EFFECTS: readonly { key: keyof LightFx; label: string; hint: string; about: string }[] = [
  { key: "enabled", label: "Light effects", hint: "All of the effects", about: "Every effect here at once. Off, none of them runs, whatever each is set to." },
  { key: "splash", label: "Splash & goodbye", hint: "Opening and leaving", about: "The warm side lights come up as Secretary opens and fade as you leave it." },
  { key: "mood", label: "Poster colour", hint: "Background colour", about: "The background takes the colour of the poster in focus." },
  { key: "sync", label: "Match lights", hint: "Side lights follow", about: "The side lights take the poster's colour too. Needs SmartThings." },
  { key: "dance", label: "Music dance", hint: "Music mode", about: "In music mode the side lights move through colours with the music." },
  { key: "shimmer", label: "Shimmer", hint: "Moving light", about: "A slow band of light slides across the background." },
];

/** What an effect shows in its preview: a little room, a screen between two side lights, doing what the effect does. */
export function EffectPreview({ effect, fx }: { effect: (typeof EFFECTS)[number]; fx: LightFx }) {
  const own = fx[effect.key];
  const on = effect.key === "enabled" ? fx.enabled : own && fx.enabled;
  const waits = effect.key !== "enabled" && own && !fx.enabled;
  return (
    <div class="lfx-pv">
      <div class={`lfx-stage is-${effect.key}${on ? " is-on" : ""}`}>
        <i class="lfx-sheen" />
        <i class="lfx-lamp is-left" />
        <i class="lfx-screen" />
        <i class="lfx-lamp is-right" />
      </div>
      <b class="lfx-title">{effect.label}</b>
      <p class="lfx-about">{effect.about}</p>
      {waits && <small class="lfx-wait">Set on, but Light effects are off</small>}
      <div class="lfx-chips">
        <span class={`lfx-chip${on ? "" : " is-on"}`}>Off</span>
        <span class={`lfx-chip${on ? " is-on" : ""}`}>On</span>
      </div>
    </div>
  );
}

/** "Ran 5 min ago", from a routine's last run. */
export function ranAgo(at: number, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - at) / 60_000));
  if (min < 1) return "Ran just now";
  if (min < 60) return `Ran ${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `Ran ${h} h ago`;
  return `Ran ${Math.round(h / 24)} d ago`;
}

