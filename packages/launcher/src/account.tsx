// Nest's account screens (docs/nuvio-cloud.md): sign in to Nuvio with a QR code or email and password, and pick
// a profile. Both sit on the glass page in place of the home screen; Back returns to it.
import {
  avatarCatalog,
  avatarImage,
  listProfiles,
  NuvioError,
  type Profile,
  type QrLogin,
  signInPassword,
  signOut,
  startQrLogin,
  verifyPin,
  waitForQrLogin,
} from "@secretary/nuvio";
import { getTvInputBridge, useKeys } from "@secretary/tv-kit";
import { Glass } from "@secretary/tv-kit/src/glass/index.ts";
import { useEffect, useMemo, useState } from "preact/hooks";
import { encode } from "uqr";
import { cloud, resetGrants } from "./cloud.ts";

/** The QR as one SVG path of dark modules (crisp at any size, no canvas). */
function QrCode({ text, size }: { text: string; size: number }) {
  const { path, n } = useMemo(() => {
    const { data } = encode(text, { ecc: "M", border: 2 });
    let d = "";
    data.forEach((row, y) => row.forEach((dark, x) => dark && (d += `M${x} ${y}h1v1h-1z`)));
    return { path: d, n: data.length };
  }, [text]);
  return (
    <svg class="nest-qr" width={size} height={size} viewBox={`0 0 ${n} ${n}`} shape-rendering="crispEdges">
      <rect width={n} height={n} fill="#fff" />
      <path d={path} fill="#101114" />
    </svg>
  );
}

const PANEL = { x: 300, y: 150, w: 1320, h: 780 };
const SIGNIN_BUTTONS = ["Use email & password", "Not now"] as const;

type QrState = { phase: "starting" } | { phase: "waiting"; login: QrLogin } | { phase: "error"; message: string };

const message = (e: unknown) =>
  e instanceof NuvioError && e.status === 400 ? "Wrong email or password" : "Nuvio Cloud can't be reached right now";

export function SignIn({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const [qr, setQr] = useState<QrState>({ phase: "starting" });
  const [focus, setFocus] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // One QR login at a time; an expired one is replaced by a new one, and leaving the screen stops polling.
  useEffect(() => {
    const ac = new AbortController();
    setQr({ phase: "starting" });
    (async () => {
      try {
        const login = await startQrLogin(cloud, { deviceName: "Secretary TV" });
        if (ac.signal.aborted) return;
        setQr({ phase: "waiting", login });
        const outcome = await waitForQrLogin(cloud, login, { signal: ac.signal });
        if (ac.signal.aborted) return;
        if (outcome === "signed-in") return onDone();
        setAttempt((n) => n + 1);
      } catch (e) {
        if (!ac.signal.aborted) setQr({ phase: "error", message: message(e) });
      }
    })();
    return () => ac.abort();
  }, [attempt]);

  const typeCredentials = () => {
    const bridge = getTvInputBridge();
    setNote("Type your Nuvio email on the TV keyboard");
    setTyping(true);
    const ok = bridge.open("", {
      onCommit: (email) => {
        if (!email.trim()) return void (setTyping(false), setNote(null));
        setNote("Now your password");
        // The keyboard closes as it commits; open the next field once it has.
        setTimeout(() => {
          bridge.open("", {
            onCommit: (password) => {
              setTyping(false);
              if (!password) return setNote(null);
              setNote("Signing in…");
              signInPassword(cloud, email, password).then(onDone, (e) => setNote(message(e)));
            },
            onCancel: () => (setTyping(false), setNote(null)),
          });
        }, 0);
      },
      onCancel: () => (setTyping(false), setNote(null)),
    });
    if (!ok) {
      setTyping(false);
      setNote("The TV keyboard isn't available here; use the QR code");
    }
  };

  useKeys(!typing, (key) => {
    if (key === "Left" || key === "Up") return void setFocus(0);
    if (key === "Right" || key === "Down") return void setFocus(1);
    if (key === "Enter") {
      if (qr.phase === "error" && focus === 1) return void setAttempt((n) => n + 1);
      return void (focus === 0 ? typeCredentials() : onClose());
    }
    if (key === "Back") return void onClose();
    return false;
  });

  const status =
    note ??
    (qr.phase === "starting" ? "Getting a code…" : qr.phase === "error" ? qr.message : "Waiting for your phone…");
  const buttons = qr.phase === "error" ? [SIGNIN_BUTTONS[0], "Try again"] : SIGNIN_BUTTONS;

  return (
    <Glass {...PANEL} class="nest-account">
      <div class="nest-signin">
        <div class="nest-qr-box">
          {qr.phase === "waiting" ? <QrCode text={qr.login.url} size={440} /> : <div class="nest-qr-wait" />}
        </div>
        <div class="nest-signin-text">
          <span class="nest-kicker">Nuvio account</span>
          <h1>Sign in to Nuvio</h1>
          <ol>
            <li>Scan the code with your phone</li>
            <li>Sign in on nuvio.tv</li>
            <li>Approve “Secretary TV”</li>
          </ol>
          <p class="nest-signin-note">
            Continue Watching, your library, addons and plugins follow your Nuvio profile on every app and device.
          </p>
          <div class="nest-signin-status">{status}</div>
        </div>
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

const TILE = 220;
const TILE_GAP = 40;

export function Profiles({ onPicked, onSignedOut, onClose }: { onPicked: (p: Profile) => void; onSignedOut: () => void; onClose: () => void }) {
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [images, setImages] = useState<ReadonlyMap<string, string>>(new Map());
  const [focus, setFocus] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const current = cloud.session.profile();

  useEffect(() => {
    listProfiles(cloud).then(
      (list) => {
        setProfiles(list);
        setFocus(Math.max(0, list.findIndex((p) => p.index === current)));
      },
      () => setNote("Nuvio Cloud can't be reached right now"),
    );
    void avatarCatalog(cloud).then(setImages);
  }, []);

  const count = (profiles?.length ?? 0) + 1;
  const pick = (p: Profile) => {
    if (!p.locked || p.index === current) return onPicked(p);
    setTyping(true);
    setNote(`Type ${p.name}'s PIN on the TV keyboard`);
    const ok = getTvInputBridge().open("", {
      onCommit: (pin) => {
        setTyping(false);
        if (!pin) return setNote(null);
        verifyPin(cloud, p.index, pin).then(
          (r) =>
            r.unlocked
              ? onPicked(p)
              : setNote(r.retryAfterSec ? `Too many tries; wait ${r.retryAfterSec} s` : "That PIN isn't right"),
          () => setNote("Couldn't check the PIN"),
        );
      },
      onCancel: () => (setTyping(false), setNote(null)),
    });
    if (!ok) {
      setTyping(false);
      setNote("The TV keyboard isn't available here");
    }
  };

  useKeys(!typing, (key) => {
    if (key === "Left") return void setFocus((f) => Math.max(0, f - 1));
    if (key === "Right") return void setFocus((f) => Math.min(count - 1, f + 1));
    if (key === "Back") return void onClose();
    if (key === "Enter") {
      const p = profiles?.[focus];
      if (p) return void pick(p);
      if (focus === count - 1) {
        void signOut(cloud).then(() => {
          resetGrants();
          onSignedOut();
        });
      }
      return;
    }
    return false;
  });

  const rowW = count * TILE + (count - 1) * TILE_GAP;
  const left = (PANEL.w - rowW) / 2;
  return (
    <Glass {...PANEL} class="nest-account">
      <div class="nest-profiles-head">
        <span class="nest-kicker">Nuvio account</span>
        <h1>Who's watching?</h1>
      </div>
      {profiles?.map((p, i) => {
        const img = avatarImage(p, images);
        return (
          <div key={p.index} class={`nest-profile${focus === i ? " is-focus" : ""}${p.index === current ? " is-picked" : ""}`} style={{ left: `${left + i * (TILE + TILE_GAP)}px`, top: "250px", width: `${TILE}px` }}>
            <span class="nest-profile-disc" style={{ background: img ? `${p.color} center / cover url("${img}")` : p.color }}>
              {img ? null : p.name.charAt(0).toUpperCase()}
            </span>
            <b>{p.name}</b>
            <small>{p.locked ? "🔒 PIN" : p.index === current ? "On this TV" : " "}</small>
          </div>
        );
      })}
      {profiles && (
        <div class={`nest-profile is-action${focus === count - 1 ? " is-focus" : ""}`} style={{ left: `${left + (count - 1) * (TILE + TILE_GAP)}px`, top: "250px", width: `${TILE}px` }}>
          <span class="nest-profile-disc">⎋</span>
          <b>Sign out</b>
          <small>of this TV</small>
        </div>
      )}
      <div class="nest-signin-status nest-profiles-note">{note ?? (profiles ? "OK picks · Back returns to Nest" : "Loading profiles…")}</div>
    </Glass>
  );
}
