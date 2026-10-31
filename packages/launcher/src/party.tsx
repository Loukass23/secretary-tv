// Nest's "Watch together" (docs/watch-party.md): type the code a friend's TV shows, see what the party is watching,
// and open the catalog app that plays it, on that title, joining the room (the launch payload's `room`).
import { contentApp, normalizeCode, partyErrorText, type RoomSummary } from "@secretary/party/src/client.ts";
import { getTvInputBridge, useKeys } from "@secretary/tv-kit";
import { Glass } from "@secretary/tv-kit/src/glass/index.ts";
import { useEffect, useState } from "preact/hooks";
import { launchApp } from "./apps.ts";
import { cloud, launchCatalogApp, partyApi } from "./cloud.ts";
import { APP_IDS } from "./config.ts";

const PANEL = { x: 360, y: 200, w: 1200, h: 680 };

type Step =
  | { kind: "idle"; note?: string }
  | { kind: "typing" }
  | { kind: "checking"; code: string }
  | { kind: "found"; room: RoomSummary };

const STATE_TEXT: Record<RoomSummary["state"], string> = {
  paused: "Paused",
  waiting: "Starting soon",
  playing: "Playing now",
  ended: "Ended",
};

export function WatchTogether({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>(() =>
    !partyApi.configured
      ? { kind: "idle", note: "Watch together is not set up in this build." }
      : cloud.session.signedIn()
        ? { kind: "idle" }
        : { kind: "idle", note: "Sign in to Nuvio first: the party knows you by your profile." },
  );
  const [focus, setFocus] = useState(0);
  const ready = partyApi.configured && cloud.session.signedIn();

  const look = (raw: string) => {
    const code = normalizeCode(raw);
    if (!code) return setStep({ kind: "idle", note: raw.trim() ? `"${raw.trim()}" is not a party code: six letters and digits.` : undefined });
    setStep({ kind: "checking", code });
    partyApi.summary(code).then(
      (room) => {
        setStep(room.state === "ended" ? { kind: "idle", note: "That party has ended." } : { kind: "found", room });
        setFocus(0);
      },
      (e) => setStep({ kind: "idle", note: partyErrorText(e) }),
    );
  };

  const type = () => {
    setStep({ kind: "typing" });
    const ok = getTvInputBridge().open("", {
      onCommit: look,
      onCancel: () => setStep({ kind: "idle" }),
    });
    if (!ok) setStep({ kind: "idle", note: "The TV keyboard isn't available here." });
  };

  // Straight to the keyboard: typing the code is the whole point of the screen.
  useEffect(() => {
    if (ready) type();
    return () => getTvInputBridge().close();
  }, []);

  const join = (room: RoomSummary) => {
    const { type: kind, titleId } = contentApp(room.contentId);
    launchCatalogApp(APP_IDS[kind], { type: kind, title: { id: titleId, name: room.title }, autoPlay: false, room: room.code }, launchApp).catch(
      () => setStep({ kind: "idle", note: "Couldn't open the app for this party." }),
    );
  };

  const buttons = step.kind === "found" ? ["Join the party", "Another code"] : ready ? ["Type a code"] : [];

  useKeys(step.kind !== "typing", (key) => {
    if (key === "Back") return void onClose();
    if (key === "Left") return void setFocus((f) => Math.max(0, f - 1));
    if (key === "Right") return void setFocus((f) => Math.min(buttons.length - 1, f + 1));
    if (key === "Enter") {
      if (step.kind === "found" && focus === 0) return join(step.room);
      if (buttons.length) type();
      return;
    }
    return false;
  });

  const status =
    step.kind === "typing"
      ? "Type the code on the TV keyboard"
      : step.kind === "checking"
        ? `Looking for ${step.code}…`
        : step.kind === "found"
          ? `${step.room.members} watching · ${STATE_TEXT[step.room.state]}`
          : step.note ?? "OK types a code · Back returns to Nest";

  return (
    <Glass {...PANEL} class="nest-account nest-party">
      <div class="nest-party-text">
        <span class="nest-kicker">Watch together</span>
        <h1>{step.kind === "found" ? step.room.title || "A party" : "Join a party"}</h1>
        <p class="nest-signin-note">
          {step.kind === "found"
            ? `Code ${step.room.code}. Everyone plays the same release from their own debrid account; play, pause and seek are shared.`
            : "The host's TV shows a six-character code in its Watch together panel. Type it here to join on this TV, with this profile."}
        </p>
        <div class="nest-signin-status">{status}</div>
      </div>
      <div class="nest-account-buttons">
        {buttons.map((label, i) => (
          <Glass key={label} x={60 + i * 440} y={PANEL.h - 120} w={400} h={72} page={[PANEL.x + 60 + i * 440, PANEL.y + PANEL.h - 120]} focused={focus === i} class="nest-button">
            <span>{label}</span>
          </Glass>
        ))}
      </div>
    </Glass>
  );
}
