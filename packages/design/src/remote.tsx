// The desktop remote: the keyboard map (keymap.ts) installed on the window, an on-screen remote that sends
// the same events, and a log of the key names the views receive.
import { keyName } from "@secretary/tv-kit";
import { useEffect, useState } from "preact/hooks";
import { desktopKeyCode, PASS_KEYS, REMOTE_KEYS, type RemoteKey } from "./keymap.ts";

/** Sends a keydown as the TV would. */
export function sendKey(win: Window, k: Pick<RemoteKey, "key" | "keyCode">, repeat = false): void {
  win.dispatchEvent(new KeyboardEvent("keydown", { key: k.key, keyCode: k.keyCode, bubbles: true, repeat }));
}

function sendUp(win: Window, k: Pick<RemoteKey, "key" | "keyCode">): void {
  win.dispatchEvent(new KeyboardEvent("keyup", { key: k.key, keyCode: k.keyCode, bubbles: true }));
}

/** A press: keydown, then keyup after `holdMs` (a quick tap without it), as a remote button sends them. */
export function pressKey(win: Window, k: Pick<RemoteKey, "key" | "keyCode">, holdMs = 0): void {
  sendKey(win, k);
  if (holdMs) setTimeout(() => sendUp(win, k), holdMs);
  else sendUp(win, k);
}

/** Install after tv-kit's installBackAdapter, before the app mounts. */
export function installDesktopRemote(win: Window): void {
  win.addEventListener(
    "keydown",
    (e) => {
      if (!e.isTrusted) return;
      if ((e.target as Element | null)?.closest?.("input, textarea, select")) return;
      const keyCode = desktopKeyCode(e.key);
      if (keyCode === null) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      // Re-sent without `key`, so use-keys.ts names it by keyCode alone, as on the TV.
      sendKey(win, { key: "", keyCode }, e.repeat);
    },
    true,
  );
  win.addEventListener("keydown", (e) => {
    const name = keyName(e);
    if (name) log(name + (e.repeat ? " (held)" : ""));
  });
}

let keys: string[] = [];
const subs = new Set<(k: string[]) => void>();
function log(name: string) {
  keys = [name, ...keys].slice(0, 8);
  for (const s of subs) s(keys);
}

/** The last key names the views received, newest first. */
export function useKeyLog(): string[] {
  const [k, setK] = useState(keys);
  useEffect(() => {
    subs.add(setK);
    return () => void subs.delete(setK);
  }, []);
  return k;
}

const BY_LABEL = new Map([...REMOTE_KEYS, ...PASS_KEYS].map((k) => [k.label, k]));

function Btn({ label, text, cls, holdMs = 0 }: { label: string; text?: string; cls?: string; holdMs?: number }) {
  const k = BY_LABEL.get(label)!;
  const hint = k.key === " " ? "Space" : k.key.replace("Arrow", "");
  return (
    <button
      class={`dz-rk${cls ? ` ${cls}` : ""}`}
      title={`${label} (${hint})`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => pressKey(window, k, holdMs)}
    >
      {text ?? label}
    </button>
  );
}

export function RemotePad() {
  const log = useKeyLog();
  return (
    <div class="dz-remote">
      <div class="dz-dpad">
        <span />
        <Btn label="Up" text="▲" />
        <span />
        <Btn label="Left" text="◀" />
        <Btn label="OK" cls="is-ok" />
        <Btn label="Right" text="▶" />
        <span />
        <Btn label="Down" text="▼" />
        <span />
      </div>
      <div class="dz-rrow">
        <Btn label="OK" text="Hold OK" holdMs={750} />
      </div>
      <div class="dz-rrow">
        <Btn label="Back" />
        <Btn label="CH-" />
        <Btn label="CH+" />
        <Btn label="Play/Pause" text="⏯" />
        <Btn label="Info" />
      </div>
      <div class="dz-rrow">
        <Btn label="Red" text="" cls="is-red" />
        <Btn label="Green" text="" cls="is-green" />
        <Btn label="Yellow" text="" cls="is-yellow" />
        <Btn label="Blue" text="" cls="is-blue" />
      </div>
      <table class="dz-keys">
        <tbody>
          {[...PASS_KEYS.slice(0, 1), ...REMOTE_KEYS].map((k) => (
            <tr key={k.label}>
              <td>{k.label === "Up" ? "Arrows, Enter, Esc" : k.label}</td>
              <td>
                <kbd>{k.label === "Up" ? "as is" : k.key === " " ? "Space" : k.key}</kbd>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div class="dz-log">{log.length ? log.join(" · ") : "Keys the screen receives show here"}</div>
    </div>
  );
}
