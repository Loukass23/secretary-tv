// Remote keys. Back arrives as keyCode 10009 (and also as tizenhwkey); only the
// keydown is used, repeats and presses inside 250 ms are dropped, and it is
// re-sent as Escape so every view closes on one key (docs/lessons.md, Input).
export const BACK_KEYCODE = 10009;
export const BACK_DEBOUNCE_MS = 250;
export const IME_DONE_KEYCODE = 65376;
export const IME_CANCEL_KEYCODE = 65385;

export const MEDIA_KEYS = [
  "MediaPlayPause",
  "MediaPlay",
  "MediaPause",
  "MediaStop",
  "MediaFastForward",
  "MediaRewind",
];

/** The remote's shortcut keys the apps use: the CH+/CH- rocker, Search, the colour keys and Info. */
export const SHORTCUT_KEYS = [
  "ChannelUp",
  "ChannelDown",
  "Search",
  "ColorF0Red",
  "ColorF1Green",
  "ColorF2Yellow",
  "ColorF3Blue",
  "Info",
];

export const ALL_REGISTERED_KEYS = [...MEDIA_KEYS, ...SHORTCUT_KEYS];

type KeyLike = { type: string; keyCode: number; repeat: boolean };

export function createBackFilter() {
  let last = Number.NEGATIVE_INFINITY;
  return (e: KeyLike, now: number): "escape" | "drop" | "pass" => {
    if (e.keyCode !== BACK_KEYCODE) return "pass";
    if (e.type !== "keydown" || e.repeat || now - last < BACK_DEBOUNCE_MS) return "drop";
    last = now;
    return "escape";
  };
}

type TizenGlobal = {
  tvinputdevice?: {
    getSupportedKeys(): { name: string; code: number }[];
    registerKeyBatch?(names: string[], ok: null, err: (e: unknown) => void): void;
    registerKey(name: string): void;
  };
  application?: {
    getCurrentApplication(): { exit(): void };
    launch(id: string, ok?: () => void, err?: (e: unknown) => void): void;
  };
};
const tizen = () => (globalThis as { tizen?: TizenGlobal }).tizen;

/**
 * Closes the app. With `returnTo` (a launcher's app id) the launcher is started first, so
 * leaving an app lands on it instead of wherever Smart Hub was.
 */
export function exitApp(returnTo?: string): void {
  const app = tizen()?.application;
  const exit = () => {
    try {
      app?.getCurrentApplication().exit();
    } catch (err) {
      console.warn("[keys] exit failed", err);
    }
  };
  if (!returnTo || !app) return exit();
  try {
    app.launch(returnTo, exit, (err) => {
      console.warn("[keys] launcher return failed", err);
      exit();
    });
  } catch (err) {
    console.warn("[keys] launcher return threw", err);
    exit();
  }
}

/** Starts another app by id and keeps this one running (it goes hidden). Rejects off-TV or on failure. */
export function launchApp(id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const app = tizen()?.application;
    if (!app) return reject(new Error("tizen.application unavailable"));
    try {
      app.launch(id, () => resolve(), reject);
    } catch (err) {
      reject(err);
    }
  });
}

/** Registers the media and channel/shortcut keys the TV supports. */
export function registerMediaKeys(): void {
  const input = tizen()?.tvinputdevice;
  if (!input) return;
  try {
    const supported = input.getSupportedKeys?.() ?? [];
    const supportedSet = new Set(supported.map((k) => k.name));
    const names = supportedSet.size
      ? ALL_REGISTERED_KEYS.filter((n) => supportedSet.has(n))
      : ALL_REGISTERED_KEYS;
    if (input.registerKeyBatch && names.length) {
      input.registerKeyBatch(names, null, (e) => console.warn("[keys]", e));
    } else {
      for (const n of names) {
        try {
          input.registerKey(n);
        } catch {
          // Ignore unsupported individual keys on older firmware.
        }
      }
    }
  } catch (err) {
    console.warn("[keys] register failed", err);
  }
}

// The TV's own on-screen keyboard (and the remote's microphone) types into a focused text field, so typing is a
// session on an off-screen field: the views read what it holds and never see the keys pressed inside it.

export interface TvImeCallbacks {
  /** The text so far, while typing. */
  onChange?(value: string): void;
  /** Done (or OK), or the keyboard left with changed text. */
  onCommit?(value: string): void;
  /** Cancel or Back, or the keyboard left with the text it opened with. */
  onCancel?(): void;
}

export interface TvInputBridge {
  readonly isOpen: boolean;
  /** The text of the session open now, or of the last one. */
  readonly value: string;
  /** Starts a session with `initialValue`; false when the field cannot take focus (no TV keyboard here). */
  open(initialValue?: string, callbacks?: TvImeCallbacks): boolean;
  /** Ends the session as cancelled. */
  close(): void;
}

let activeImeBridge: TvInputBridge | null = null;

export function isTvImeOpen(): boolean {
  return Boolean(activeImeBridge?.isOpen);
}

const FIELD_ID = "tv-keyboard-field";
/** Keys that end a typing session from the TV keyboard or the remote. */
const DONE_KEYS = new Set([IME_DONE_KEYCODE, 13]);
const CANCEL_KEYS = new Set([IME_CANCEL_KEYCODE, 27, BACK_KEYCODE]);
/** CH+ and CH- leave the keyboard and still reach the app (Nest, Search). */
const PASS_KEYS = new Set([427, 428]);

export function createTvInputBridge(doc: Document = document): TvInputBridge {
  type Session = { opened: string; text: string; callbacks: TvImeCallbacks };
  let session: Session | null = null;
  let lastText = "";

  function end(outcome: "commit" | "cancel"): void {
    const s = session;
    if (!s) return;
    session = null;
    lastText = s.text;
    doc.getElementById(FIELD_ID)?.blur();
    if (outcome === "commit") s.callbacks.onCommit?.(s.text);
    else s.callbacks.onCancel?.();
  }

  function field(): HTMLInputElement | null {
    const found = doc.getElementById(FIELD_ID) as HTMLInputElement | null;
    if (found || !doc.body) return found;
    const f = doc.createElement("input");
    f.id = FIELD_ID;
    f.type = "text";
    f.autocomplete = "off";
    f.spellcheck = false;
    f.tabIndex = -1;
    f.setAttribute("aria-hidden", "true");
    // On the page, so the TV keyboard attaches to it, but off the visible area and never under the pointer.
    f.style.cssText = "position:fixed;left:-10px;top:-10px;width:1px;height:1px;opacity:0;border:0;padding:0;pointer-events:none";
    f.addEventListener("input", () => {
      if (!session || f.value === session.text) return;
      session.text = f.value;
      session.callbacks.onChange?.(f.value);
    });
    // The keyboard closed some other way (its own hide key, a focus change): keep the text only if it changed.
    f.addEventListener("blur", () => {
      if (session) end(f.value !== session.opened ? "commit" : "cancel");
    });
    f.addEventListener("keydown", (e) => {
      if (!session) return;
      if (PASS_KEYS.has(e.keyCode)) return end("cancel");
      // Every other key stays in the keyboard: the views behind must not move while typing.
      e.stopPropagation();
      if (DONE_KEYS.has(e.keyCode) || e.key === "Enter") {
        e.preventDefault();
        session.text = f.value;
        end("commit");
      } else if (CANCEL_KEYS.has(e.keyCode) || e.key === "Escape") {
        e.preventDefault();
        end("cancel");
      }
    });
    doc.body.appendChild(f);
    return f;
  }

  const bridge: TvInputBridge = {
    get isOpen() {
      return session != null;
    },
    get value() {
      return session?.text ?? lastText;
    },
    open(initialValue = "", callbacks: TvImeCallbacks = {}): boolean {
      if (session) end("cancel");
      const f = field();
      if (!f) return false;
      f.value = initialValue;
      session = { opened: initialValue, text: initialValue, callbacks };
      try {
        f.focus();
        f.setSelectionRange(initialValue.length, initialValue.length);
      } catch {
        // A field that cannot take focus is reported below.
      }
      if (doc.activeElement === f) return true;
      session = null;
      return false;
    },
    close(): void {
      end("cancel");
    },
  };

  activeImeBridge = bridge;
  return bridge;
}

export function getTvInputBridge(): TvInputBridge {
  if (!activeImeBridge && typeof document !== "undefined") {
    activeImeBridge = createTvInputBridge(document);
  }
  return activeImeBridge!;
}

/** Must run before the app mounts so it is the first capture listener. */
export function installBackAdapter(win: Window): void {
  const filter = createBackFilter();
  const onKey = (e: KeyboardEvent) => {
    // While typing, Back ends the typing session only, not the view behind it.
    if (isTvImeOpen() && e.keyCode === BACK_KEYCODE) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.type === "keydown" && !e.repeat) {
        activeImeBridge?.close();
      }
      return;
    }
    const action = filter(e, performance.now());
    if (action === "pass") return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (action === "drop") return;
    win.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }),
    );
  };
  win.addEventListener("keydown", onKey, true);
  win.addEventListener("keyup", onKey, true);
}
