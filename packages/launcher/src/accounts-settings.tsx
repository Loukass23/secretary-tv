// Settings › Accounts (a category Secretary adds to the catalog's Settings, catalog-kit host.ts): Simkl, the watch
// tracker (docs/simkl.md). Connect shows a code and a QR for simkl.com/pin; the phone signs in and the TV checks
// until the code is used. Signed in, what plays is scrobbled and the history comes back on each sync.
import type { HostSettingRow, HostSettingsTab } from "@secretary/catalog-kit/src/host.ts";
import { setResumeTrackers, syncAllResume } from "@secretary/catalog-kit/src/lib/resume.ts";
import { simklLastSync, simklPullSoon, simklSignOut, simklTracker } from "@secretary/catalog-kit/src/lib/simkl.ts";
import { createSimkl, type PinCode, type SimklClient, startPin, waitForPin } from "@secretary/simkl";
import { readJson, writeJson } from "@secretary/tv-kit";
import { QrCode } from "./qr.tsx";

declare const __SIMKL_CLIENT_ID__: string | undefined;

export const ACCOUNTS_TAB = "Accounts";

const clientId = () => (typeof __SIMKL_CLIENT_ID__ !== "undefined" ? __SIMKL_CLIENT_ID__ : "");

let client: SimklClient | null = null;

/** The one Simkl client, or null when this build has no client id (`SIMKL_CLIENT_ID` in .env.tizen). */
export function simkl(): SimklClient | null {
  if (!clientId()) return null;
  client ??= createSimkl({ clientId: clientId(), kv: { get: readJson, set: writeJson } });
  return client;
}

/** Starts the trackers the viewer has connected; called once when Secretary starts. */
export function startTrackers(): void {
  const c = simkl();
  setResumeTrackers(c ? [simklTracker(c)] : []);
}

type Pin = { phase: "idle" } | { phase: "asking" } | { phase: "waiting"; code: PinCode } | { phase: "failed"; why: string };

let pin: Pin = { phase: "idle" };
let stop: AbortController | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

function connect(c: SimklClient): void {
  stop?.abort();
  stop = new AbortController();
  const signal = stop.signal;
  pin = { phase: "asking" };
  changed();
  startPin(c).then(
    async (code) => {
      if (signal.aborted) return;
      pin = { phase: "waiting", code };
      changed();
      const ok = await waitForPin(c, code, { signal });
      if (signal.aborted) return;
      pin = ok ? { phase: "idle" } : { phase: "failed", why: "The code ran out. OK gives a new one." };
      if (ok) simklPullSoon();
      changed();
    },
    () => {
      if (signal.aborted) return;
      pin = { phase: "failed", why: "Simkl did not answer. Check the connection and press OK again." };
      changed();
    },
  );
}

function since(at: number, now = Date.now()): string {
  if (!at) return "Not synced yet";
  const min = Math.max(0, Math.round((now - at) / 60_000));
  if (min < 1) return "Synced just now";
  if (min < 60) return `Synced ${min} min ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `Synced ${h} h ago` : `Synced ${Math.round(h / 24)} d ago`;
}

function SimklPreview({ signedIn }: { signedIn: boolean }) {
  if (pin.phase === "waiting") {
    const url = pin.code.url;
    return (
      <div class="lfx-pv acc-pv">
        <div class="acc-pin">
          <QrCode text={url} size={200} />
          <div>
            <small class="acc-kicker">On your phone, open</small>
            <b class="acc-url">{url.replace(/^https?:\/\//, "")}</b>
            <small class="acc-kicker">and enter</small>
            <b class="acc-code">{pin.code.userCode}</b>
          </div>
        </div>
        <p class="lfx-about">Secretary checks every few seconds and connects as soon as you confirm.</p>
      </div>
    );
  }
  return (
    <div class="lfx-pv acc-pv">
      <b class="lfx-title">Simkl</b>
      <p class="lfx-about">
        {signedIn
          ? "What you watch here is scrobbled to Simkl, and what you watched elsewhere comes back as watched."
          : "Connect a Simkl account to keep your watch history in step with your other devices and apps."}
      </p>
      {pin.phase === "failed" && <small class="lfx-wait">{pin.why}</small>}
      <div class="lfx-chips">
        <span class={`lfx-chip${signedIn ? "" : " is-on"}`}>{pin.phase === "asking" ? "Asking…" : "Not connected"}</span>
        <span class={`lfx-chip${signedIn ? " is-on" : ""}`}>Connected</span>
      </div>
    </div>
  );
}

function rows(c: SimklClient | null): HostSettingRow[] {
  if (!c) {
    return [{ key: "simkl", title: "Simkl", sub: "This build has no Simkl client id", value: "Unavailable" }];
  }
  const signedIn = c.signedIn();
  const list: HostSettingRow[] = [
    {
      key: "simkl",
      title: "Simkl",
      sub: signedIn ? "Watch history and scrobbling" : "OK shows a code to connect on your phone",
      value: signedIn ? "Connected" : pin.phase === "waiting" ? `Code ${pin.code.userCode}` : "Not connected",
      on: signedIn,
      preview: <SimklPreview signedIn={signedIn} />,
      act: (key) => {
        if (key !== "Enter") return;
        if (signedIn) return;
        if (pin.phase === "waiting") {
          stop?.abort();
          pin = { phase: "idle" };
          return;
        }
        connect(c);
      },
    },
  ];
  if (signedIn) {
    list.push(
      {
        key: "simkl:sync",
        title: "Sync now",
        sub: "Brings the Simkl history back on the next return home",
        value: since(simklLastSync()),
        act: (key) => {
          if (key !== "Enter") return;
          simklPullSoon();
          void syncAllResume().then(changed, changed);
        },
      },
      {
        key: "simkl:out",
        title: "Disconnect Simkl",
        sub: "Stops scrobbling; your watched marks stay on this TV",
        value: "",
        act: (key) => {
          if (key === "Enter") simklSignOut(c);
        },
      },
    );
  }
  return list;
}

export function accountsTab(): HostSettingsTab {
  const c = simkl();
  return {
    name: ACCOUNTS_TAB,
    blurb: c?.signedIn() ? "Simkl is connected: what you watch is tracked there too." : "Connect a watch tracker to keep history in step.",
    rows: () => rows(simkl()),
    subscribe(redraw) {
      listeners.add(redraw);
      return () => void listeners.delete(redraw);
    },
  };
}
