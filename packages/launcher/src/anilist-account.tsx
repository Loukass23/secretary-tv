// Settings › Accounts › AniList (docs/anilist.md). AniList has no sign-in made for TVs: the phone opens AniList's
// sign-in from one QR, which ends on AniList's pin page showing a token, and pastes that token into Secretary Desk's
// phone keyboard from the second QR (phone-keys.ts). Without Desk, the TV keyboard takes it.
import type { HostSettingRow } from "@secretary/catalog-kit/src/host.ts";
import { anilistLastSync, anilistPullSoon, anilistSignIn, anilistSignOut } from "@secretary/catalog-kit/src/lib/anilist.ts";
import { syncAllResume } from "@secretary/catalog-kit/src/lib/resume.ts";
import { type AniListClient, authorizeUrl, createAniList, tokenFromText } from "@secretary/anilist";
import { getTvInputBridge, readJson, writeJson } from "@secretary/tv-kit";
import { phoneUrl, typeCode, watchPhone } from "./phone-keys.ts";
import { QrCode } from "./qr.tsx";

declare const __ANILIST_CLIENT_ID__: string | undefined;

const clientId = () => (typeof __ANILIST_CLIENT_ID__ !== "undefined" ? __ANILIST_CLIENT_ID__ : "");

let client: AniListClient | null = null;

/** The one AniList client, or null when this build has no client id (`ANILIST_CLIENT_ID` in .env.tizen). */
export function anilist(): AniListClient | null {
  if (!clientId()) return null;
  client ??= createAniList({ clientId: clientId(), kv: { get: readJson, set: writeJson } });
  return client;
}

type Step =
  | { phase: "idle"; note?: string }
  | { phase: "pasting"; code: string; desk: string }
  | { phase: "checking" }
  | { phase: "failed"; why: string };

let step: Step = { phase: "idle" };
let stopWatch: (() => void) | null = null;

function finish(next: Step, changed: () => void): void {
  stopWatch?.();
  stopWatch = null;
  step = next;
  changed();
}

/** A pasted text: kept when it holds a token AniList accepts. */
async function take(c: AniListClient, text: string, changed: () => void): Promise<void> {
  const token = tokenFromText(text);
  if (!token) return;
  stopWatch?.();
  stopWatch = null;
  step = { phase: "checking" };
  changed();
  const name = await anilistSignIn(c, token);
  finish(name ? { phase: "idle", note: `Connected as ${name}` } : { phase: "failed", why: "AniList refused that token. OK starts again." }, changed);
}

function connect(c: AniListClient, desk: string, changed: () => void): void {
  stopWatch?.();
  if (!desk) {
    // No Secretary Desk: the TV keyboard, for a token sent to the TV some other way.
    const opened = getTvInputBridge()?.open("", { onCommit: (v) => void take(c, v, changed) });
    step = opened ? { phase: "idle" } : { phase: "failed", why: "Pasting the token needs Secretary Desk running (the home server)." };
    return changed();
  }
  const code = typeCode();
  step = { phase: "pasting", code, desk };
  stopWatch = watchPhone(desk, code, (text) => void take(c, text, changed));
  changed();
}

function Preview({ c, signedIn }: { c: AniListClient; signedIn: boolean }) {
  if (step.phase === "pasting") {
    return (
      <div class="lfx-pv acc-pv">
        <div class="acc-two">
          <div class="acc-step">
            <QrCode text={authorizeUrl(c.clientId)} size={180} />
            <small class="acc-kicker">1 · Sign in to AniList and copy the token it shows</small>
          </div>
          <div class="acc-step">
            <QrCode text={phoneUrl(step.desk, step.code)} size={180} />
            <small class="acc-kicker">2 · Paste it into this phone keyboard</small>
          </div>
        </div>
        <p class="lfx-about">Secretary checks the token with AniList and connects as soon as it arrives.</p>
      </div>
    );
  }
  return (
    <div class="lfx-pv acc-pv">
      <b class="lfx-title">AniList</b>
      <p class="lfx-about">
        {signedIn
          ? "Anime episodes you finish here move your AniList progress forward, and your lists come back as watched."
          : "Connect an AniList account to keep your anime lists in step with what you watch here."}
      </p>
      {step.phase === "failed" && <small class="lfx-wait">{step.why}</small>}
      {step.phase === "idle" && step.note && <small class="lfx-wait">{step.note}</small>}
      <div class="lfx-chips">
        <span class={`lfx-chip${signedIn ? "" : " is-on"}`}>{step.phase === "checking" ? "Checking…" : "Not connected"}</span>
        <span class={`lfx-chip${signedIn ? " is-on" : ""}`}>Connected</span>
      </div>
    </div>
  );
}

const since = (at: number, now = Date.now()) => {
  if (!at) return "Not synced yet";
  const min = Math.max(0, Math.round((now - at) / 60_000));
  if (min < 1) return "Synced just now";
  if (min < 60) return `Synced ${min} min ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `Synced ${h} h ago` : `Synced ${Math.round(h / 24)} d ago`;
};

/** The AniList lines of Settings › Accounts. `desk` is Secretary Desk's address while it answers, else "". */
export function anilistRows(desk: string, changed: () => void): HostSettingRow[] {
  const c = anilist();
  if (!c) return [{ key: "anilist", title: "AniList", sub: "This build has no AniList client id", value: "Unavailable" }];
  const signedIn = c.signedIn();
  const rows: HostSettingRow[] = [
    {
      key: "anilist",
      title: "AniList",
      sub: signedIn ? "Anime progress and lists" : "OK shows the QR codes to connect from your phone",
      value: signedIn ? "Connected" : step.phase === "pasting" ? "Waiting for the token" : "Not connected",
      on: signedIn,
      preview: <Preview c={c} signedIn={signedIn} />,
      act: (key) => {
        if (key !== "Enter" || signedIn) return;
        if (step.phase === "pasting") return finish({ phase: "idle" }, changed);
        connect(c, desk, changed);
      },
    },
  ];
  if (signedIn) {
    rows.push(
      {
        key: "anilist:sync",
        title: "Sync AniList now",
        sub: "Brings your AniList lists back as watched",
        value: since(anilistLastSync()),
        act: (key) => {
          if (key !== "Enter") return;
          anilistPullSoon();
          void syncAllResume().then(changed, changed);
        },
      },
      {
        key: "anilist:out",
        title: "Disconnect AniList",
        sub: "Stops updating AniList; your watched marks stay on this TV",
        value: "",
        act: (key) => {
          if (key === "Enter") anilistSignOut(c);
        },
      },
    );
  }
  return rows;
}
