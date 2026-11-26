// The Mood panel (the header's lights button): a few activities, each one press that switches several things at once
// (moods.ts), as a list beside a preview of what the focused one will do, the active one marked. Its last line opens
// Settings › SmartThings, where the effects, routines and lights are set up one by one.
import { useKeys } from "@secretary/tv-kit";
import { Kicker, PreviewList } from "@secretary/tv-kit/src/glass/index.ts";
import type { StDevice, StScene } from "@secretary/smartthings";
import { useMemo, useState } from "preact/hooks";
import { lightCount } from "./light-count.ts";
import { activeMood, MOODS, type Mood, moodRoutines, routineMoods } from "./moods.ts";
import { HEADER_LIGHTS } from "./nest-nav.ts";
import { type PanelHeader, usePanelHeader } from "./panel-header.tsx";

const TITLE = { x: 80, y: 146 };
const LIST = { x: 80, y: 290, w: 1760, h: 750, listW: 640 };
/** The last line: Settings › SmartThings. */
const SETUP = "setup";

/** The little room of the effects' previews (style.css .lfx-*), lit the way a mood leaves it. */
const STAGE: Record<string, string> = {
  cinema: "is-sync is-on is-dim",
  music: "is-dance is-on",
  dining: "is-warm is-on",
  off: "",
};

function MoodPreview({ mood, active }: { mood: Mood | null; active: boolean }) {
  if (!mood) {
    return (
      <div class="lfx-pv">
        <div class="lfx-stage is-on">
          <i class="lfx-lamp is-left" />
          <i class="lfx-screen" />
          <i class="lfx-lamp is-right" />
        </div>
        <b class="lfx-title">SmartThings settings</b>
        <p class="lfx-about">Each light effect and its switch, the routines to show here and which runs with a film, and every light by room.</p>
      </div>
    );
  }
  return (
    <div class="lfx-pv">
      <div class={`lfx-stage ${STAGE[mood.key] ?? "is-on"}`}>
        <i class="lfx-sheen" />
        <i class="lfx-lamp is-left" />
        <i class="lfx-screen" />
        <i class="lfx-lamp is-right" />
      </div>
      <b class="lfx-title">{mood.label}</b>
      <ul class="mood-does">
        {mood.does.map((d) => (
          <li key={d}>{d}</li>
        ))}
      </ul>
      <div class="lfx-chips">
        <span class={`lfx-chip${active ? " is-on" : ""}`}>{active ? "Active" : "OK sets it"}</span>
      </div>
    </div>
  );
}

export function MoodPanel({
  devices,
  scenes,
  onMood,
  onSetup,
  onClose,
  header,
}: {
  devices: readonly StDevice[];
  scenes: readonly StScene[];
  /** Sets the mood (app.tsx applyMood): its effects, then its lights; the promise says whether the lights took it. */
  onMood: (m: Mood) => Promise<void>;
  /** Opens Settings › SmartThings. */
  onSetup: () => void;
  onClose: () => void;
  header: PanelHeader;
}) {
  const moods = useMemo(() => [...MOODS, ...routineMoods(scenes, moodRoutines())], [scenes]);
  const [at, setAt] = useState(0);
  const [active, setActive] = useState(activeMood);
  const [note, setNote] = useState<string | null>(null);
  const head = usePanelHeader(header, HEADER_LIGHTS);
  // The same count as the Home card's (light-count.ts).
  const count = lightCount(devices);
  const lines = moods.length + 1;
  const i = Math.min(at, lines - 1);

  useKeys(true, (key) => {
    if (head.key(key)) return;
    if (key === "Back") return void onClose();
    if (key === "Up") return i === 0 ? void head.enter() : void setAt(i - 1);
    if (key === "Down") return void setAt(Math.min(lines - 1, i + 1));
    if (key === "Enter") {
      const m = moods[i];
      if (!m) return onSetup();
      setActive(m.key);
      setNote(`${m.label}…`);
      onMood(m).then(
        () => setNote(`${m.label} is on`),
        (e) => setNote(e instanceof Error && e.message ? e.message : `Couldn't set ${m.label}`),
      );
      return;
    }
    return false;
  });

  return (
    <>
      {head.view}
      <div class="nest-lights-head" style={{ left: `${TITLE.x}px`, top: `${TITLE.y}px` }}>
        <Kicker>Lights</Kicker>
        <h1>
          Mood
          {count.total > 0 && (
            <small>
              {count.on} of {count.total} on
            </small>
          )}
        </h1>
      </div>
      <div class="nest-lights-status" style={{ left: `${LIST.x + LIST.listW + 32}px`, top: `${TITLE.y + 64}px`, width: `${LIST.w - LIST.listW - 32}px` }}>
        {note ?? ""}
      </div>
      <PreviewList
        {...LIST}
        kicker="Moods"
        items={[
          ...moods.map((m) => ({ key: m.key, title: m.label, sub: m.hint, meta: active === m.key ? "Active" : undefined, lit: active === m.key, color: "var(--sg-line)" })),
          { key: SETUP, title: "SmartThings settings", sub: "Effects, routines and lights, one by one" },
        ]}
        focusIndex={head.head == null ? i : -1}
        shown={i}
        preview={<MoodPreview mood={moods[i] ?? null} active={moods[i]?.key === active} />}
      />
    </>
  );
}
