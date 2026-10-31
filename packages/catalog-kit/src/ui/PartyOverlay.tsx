// The watch party over the video (docs/watch-party.md): smoked glass with no frost, like the player's controls. A chip
// with the code and who is in, reactions as they arrive, and on Up the panel: the code and a QR to join, the members
// and their state, reactions to send, and the host's controls.
import { REACTIONS, type MemberView, type Reaction } from "@secretary/party/src/protocol.ts";
import { useKeys } from "@secretary/tv-kit";
import { Glass, GlassRoot } from "@secretary/tv-kit/src/glass/index.ts";
import { useEffect, useMemo, useState } from "preact/hooks";
import { encode } from "uqr";
import { LEAVE_TEXT, PARTY, type PartySession, type PartyView } from "../lib/party.ts";
import "./party.css";

export const EMOJI: Record<Reaction, string> = {
  laugh: "😂",
  wow: "😮",
  love: "❤️",
  sad: "😢",
  clap: "👏",
  fire: "🔥",
  scared: "😱",
  eyes: "👀",
};

const NOTICE_MS = 3000;

/** The QR as one SVG path of dark modules (crisp at any size, no canvas), as in Nest's sign-in. */
function QrCode({ text, size }: { text: string; size: number }) {
  const { path, n } = useMemo(() => {
    const { data } = encode(text, { ecc: "M", border: 2 });
    let d = "";
    data.forEach((row, y) => row.forEach((dark, x) => dark && (d += `M${x} ${y}h1v1h-1z`)));
    return { path: d, n: data.length };
  }, [text]);
  return (
    <svg class="pty-qr" width={size} height={size} viewBox={`0 0 ${n} ${n}`} shape-rendering="crispEdges">
      <rect width={n} height={n} fill="#fff" />
      <path d={path} fill="#101114" />
    </svg>
  );
}

const memberLine = (m: MemberView) => {
  if (!m.connected) return "Reconnecting…";
  if (m.status === "catching_up") return "Catching up";
  return { loading: "Opening…", ready: "Ready", paused: "Paused", playing: "Watching", buffering: "Buffering…", ended: "Finished", error: "Can't play this release" }[m.phase];
};

/** The room's state in a few words, for the chip and the starting screen. */
export function partyLine(v: PartyView): string {
  if (v.status === "closed") return LEAVE_TEXT[v.reason ?? "left"];
  if (v.status !== "open") return v.you ? "Reconnecting to the party…" : "Joining the party…";
  if (!v.tl) return "";
  if (v.tl.state === "waiting") {
    const behind = v.members.filter((m) => m.connected && m.status === "synced" && m.phase !== "ready" && m.phase !== "paused");
    return behind.length ? `Starting together · waiting for ${behind.map((m) => m.name).join(", ")}` : "Starting together…";
  }
  if (v.tl.state === "paused") return "Paused for everyone";
  return "Watching together";
}

/** Subscribes to the session: the view, re-rendered on every change and each second while something fades out. */
export function usePartyView(session: PartySession | null): PartyView | null {
  const [view, setView] = useState(() => session?.get() ?? null);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!session) return setView(null);
    setView(session.get());
    return session.subscribe(setView);
  }, [session]);
  const fading = Boolean(view && (view.reactions.length || view.notice));
  useEffect(() => {
    if (!fading) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [fading]);
  return view;
}

interface Props {
  session: PartySession;
  view: PartyView;
  /** The panel is open and has the keys. */
  open: boolean;
  onClose(): void;
  /** Leave the party and the player. */
  onLeave(): void;
}

export function PartyOverlay({ session, view, open, onClose, onLeave }: Props) {
  const [row, setRow] = useState(0);
  const [col, setCol] = useState(0);
  const host = session.isHost();
  const others = view.members.filter((m) => m.id !== view.you);
  const actions = host ? (["Close", "Leave", "End for everyone"] as const) : (["Close", "Leave"] as const);
  const lengths = [REACTIONS.length, host ? others.length : 0, actions.length];

  useEffect(() => {
    if (open) {
      setRow(0);
      setCol(0);
    }
  }, [open]);

  useKeys(open, (key) => {
    if (key === "Back" || (key === "Up" && row === 0)) return void onClose();
    if (key === "Up" || key === "Down") {
      let r = row;
      do r += key === "Down" ? 1 : -1;
      while (r >= 0 && r < lengths.length && !lengths[r]);
      if (r >= 0 && r < lengths.length) {
        setRow(r);
        setCol((c) => Math.min(c, lengths[r] - 1));
      }
      return;
    }
    if (key === "Left") return void setCol((c) => Math.max(0, c - 1));
    if (key === "Right") return void setCol((c) => Math.min(lengths[row] - 1, c + 1));
    if (key === "Enter") {
      if (row === 0) return void session.react(REACTIONS[col]);
      if (row === 1) {
        const to = others[col];
        if (to) session.handOver(to.id);
        return;
      }
      const act = actions[col];
      if (act === "Close") return onClose();
      if (act === "End for everyone") session.command("end");
      return onLeave();
    }
    return false;
  });

  const now = Date.now();
  const names = new Map(view.members.map((m) => [m.id, m]));
  const notice = view.notice && now - view.notice.at < NOTICE_MS ? view.notice.text : null;
  const reactions = view.reactions.filter((r) => now - r.at < PARTY.reactionMs);
  const connected = view.members.filter((m) => m.connected).length;

  return (
    <GlassRoot mode="flat" class="pty-root">
      {!open && (
        <Glass x={1500} y={60} w={340} h={64} class="pty-chip">
          <span>👥 {view.code}</span>
          <span class="ply-dim">{view.status === "open" ? `${connected} in · Up opens` : "Reconnecting…"}</span>
        </Glass>
      )}
      {reactions.map((r, i) => (
        <div key={r.id} class="pty-react" style={{ top: `${600 - i * 76}px` }}>
          <b>{EMOJI[r.emoji]}</b>
          <span style={{ color: names.get(r.from)?.color }}>{names.get(r.from)?.name ?? ""}</span>
        </div>
      ))}
      {notice && (
        <Glass x={660} y={60} w={600} h={64} class="pty-notice">
          <span>{notice}</span>
        </Glass>
      )}
      {open && (
        <Glass x={80} y={80} w={1760} h={660} class="pty-panel">
          <div class="pty-join">
            <div class="pty-qr-box">{view.joinUrl && <QrCode text={view.joinUrl} size={260} />}</div>
            <span class="ply-state">Party code</span>
            <b class="pty-code">{view.code}</b>
            <span class="ply-dim">Nest › 👥 Watch together on the other TV, then type this code.</span>
          </div>
          <div class="pty-main">
            <span class="ply-state">{partyLine(view)}</span>
            <div class="pty-members">
              {view.members.map((m) => {
                const i = others.indexOf(m);
                return (
                  <div key={m.id} class={`pty-member${row === 1 && i === col ? " is-focus" : ""}${m.connected ? "" : " is-away"}`}>
                    <i style={{ background: m.color }}>{m.name.charAt(0).toUpperCase()}</i>
                    <b>
                      {m.name}
                      {m.id === view.you ? " (you)" : ""}
                    </b>
                    <small>{m.host ? `Host · ${memberLine(m)}` : memberLine(m)}</small>
                  </div>
                );
              })}
            </div>
            <span class="ply-dim">
              {host
                ? others.length
                  ? "OK on someone makes them the host."
                  : "Nobody else yet: share the code."
                : view.control === "host"
                  ? "The host controls playback."
                  : "Everyone controls playback."}
            </span>
            <div class="pty-reactions">
              {REACTIONS.map((r, i) => (
                <span key={r} class={`pty-emoji${row === 0 && col === i ? " is-focus" : ""}`}>
                  {EMOJI[r]}
                </span>
              ))}
            </div>
            <div class="pty-actions">
              {actions.map((a, i) => (
                <span key={a} class={`cat-btn${row === 2 && col === i ? " is-focus" : ""}`}>
                  {a}
                </span>
              ))}
            </div>
          </div>
        </Glass>
      )}
    </GlassRoot>
  );
}
