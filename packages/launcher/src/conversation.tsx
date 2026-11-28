// Secretary's page-tailored bottom Assistant Dock and full-screen Conversation view.
import type { ComponentChildren } from "preact";
import { MediaTile, VoiceWave, WAVE_ORB, WAVE_ORB_LISTEN, type WaveState } from "@secretary/tv-kit/src/glass/index.ts";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { posterUrl, type SearchResult } from "./apps.ts";
import type { TailoredAssistant } from "./assistant-context.ts";
import type { AssistantTurn } from "./assistant.ts";
import type { ConversationFocus } from "./conversation-nav.ts";
import type { AudioRouteState } from "./voice.ts";

export const MAX_INLINE_RESULTS = 6;
const POSTER_W = 172;
const POSTER_H = 258;
const POSTER_GAP = 22;
const THREAD_H = 696;
const KIND_TAG: Record<SearchResult["type"], string> = { movie: "Film", series: "Series", anime: "Anime" };

const Orb = ({ cls, cool }: { cls: string; cool?: boolean }) => (
  <span class={cls} style={{ backgroundImage: cool ? WAVE_ORB_LISTEN : WAVE_ORB }} />
);

const Chip = ({ on, kind, children }: { on: boolean; kind?: string; children: ComponentChildren }) => (
  <span class={`nest-chip${kind ? ` nest-chip-${kind}` : ""}${on ? " is-focus" : ""}`}>{children}</span>
);

function audioBadgeText(a: AudioRouteState): string {
  return a.bluetooth ? "Bluetooth AI audio" : a.roomMic || a.sinkId ? "Room speakerphone" : a.hasMic ? "Microphone ready" : "Remote & keyboard";
}

export interface AssistantDockProps {
  wave: WaveState;
  status: string;
  reply: string;
  tailored: TailoredAssistant;
  focused: boolean;
  focusIndex: number;
  compact: boolean;
  hidden: boolean;
  listening: boolean;
  audio: AudioRouteState;
}

export function AssistantDock({ wave, status, reply, tailored, focused, focusIndex, compact, hidden, listening, audio }: AssistantDockProps) {
  const busy = wave !== "idle";
  const active = focused || busy;
  const chips = tailored.dockChips;
  const lineText = status || (busy && reply ? reply : tailored.hint);

  return (
    <div class={`nest-dock-wrap${compact ? " is-compact" : ""}${active ? " is-active" : ""}${focused ? " is-focused" : ""}${hidden ? " is-hidden" : ""}`}>
      <div class={`nest-dock-wave${!compact || active ? " is-shown" : ""}`}>
        <VoiceWave x={0} y={0} w={1920} h={84} state={wave} />
      </div>
      <div class={`nest-dock-rest${focused ? " is-out" : ""}`}>
        <Orb cls="nest-dock-orb" cool={listening} />
        <span class="nest-dock-badge">{tailored.badge}</span>
        <span class={`nest-dock-line${busy ? " is-live" : ""}`}>{lineText}</span>
        {audio.bluetooth && <span class="nest-dock-bt">BT</span>}
      </div>
      <div class={`nest-dock-bar${focused ? " is-in" : ""}`}>
        <div class="nest-dock-head">
          <span class="nest-dock-badge">{tailored.badge}</span>
          <span class="nest-dock-sub">{status || tailored.hint}</span>
        </div>
        <div class="nest-dock-items">
          <Chip on={focusIndex === 0} kind="primary">
            <Orb cls="nest-chip-dot" cool={listening} />
            {listening ? "Stop listening" : "Speak"}
          </Chip>
          {chips.map((c, idx) => (
            <Chip key={c} on={focusIndex === idx + 1}>{c}</Chip>
          ))}
          <Chip on={focusIndex === chips.length + 1} kind="chat">Conversation</Chip>
        </div>
      </div>
    </div>
  );
}

export interface ConversationOverlayProps {
  open: boolean;
  turns: readonly AssistantTurn[];
  wave: WaveState;
  status: string;
  listening: boolean;
  asking: boolean;
  pendingPrompt?: string;
  tailored: TailoredAssistant;
  focus: ConversationFocus;
  audio: AudioRouteState;
  speakOn: boolean;
  canSpeak: boolean;
}

export function ConversationOverlay({ open, turns, wave, status, listening, asking, pendingPrompt, tailored, focus, audio, speakOn, canSpeak }: ConversationOverlayProps) {
  const scrollInner = useRef<HTMLDivElement>(null);
  const [scrollY, setScrollY] = useState(0);

  const turnResultRow = new Map<number, number>();
  let nextRow = 0;
  for (const t of turns) if (t.results?.length) turnResultRow.set(t.id, nextRow++);

  useLayoutEffect(() => {
    if (!open) return;
    const el = scrollInner.current;
    if (!el) return;
    const maxScroll = Math.max(0, el.offsetHeight - THREAD_H);
    if (focus.zone === "results" && focus.row !== undefined) {
      const target = el.querySelector<HTMLElement>(`[data-res-row="${focus.row}"]`);
      if (target) {
        const ideal = target.offsetTop - Math.max(24, Math.floor((THREAD_H - target.offsetHeight) / 2));
        setScrollY(Math.max(0, Math.min(maxScroll, ideal)));
        return;
      }
    }
    const lastTurn = el.querySelector<HTMLElement>(".nest-turn:last-child");
    const lastTop = lastTurn && lastTurn.offsetHeight <= THREAD_H ? lastTurn.offsetTop : maxScroll;
    setScrollY(Math.max(0, Math.min(maxScroll, lastTop)));
  }, [open, turns.length, asking, listening, pendingPrompt, focus.zone, focus.row]);

  if (!open) return null;
  const chips = tailored.chatChips;

  return (
    <div class="nest-conv">
      <div class="nest-conv-top">
        <div class="nest-conv-brand">
          <Orb cls="nest-conv-orb" cool={listening} />
          <b>Secretary</b>
          <span class="nest-dock-badge">{tailored.badge}</span>
          <span class={`nest-conv-audio${audio.bluetooth ? " is-bt" : ""}`}>{audioBadgeText(audio)}</span>
        </div>
        <small class="nest-conv-hint">Arrows choose suggestions or titles · OK selects · Back closes</small>
      </div>

      <div class="sg-clip nest-conv-thread">
        <div ref={scrollInner} class="nest-conv-scroll" style={{ transform: `translate3d(0, -${scrollY}px, 0)` }}>
          {turns.length === 0 && !asking && (
            <div class="nest-msg nest-msg-bot">
              <Orb cls="nest-msg-avatar" />
              <div class="nest-msg-bubble"><p>{tailored.welcome}</p></div>
            </div>
          )}

          {turns.map((t) => {
            const resRow = turnResultRow.get(t.id);
            const items = t.results ? t.results.slice(0, MAX_INLINE_RESULTS) : [];
            const rowFocused = resRow !== undefined && focus.zone === "results" && focus.row === resRow;
            const picked = items[rowFocused ? Math.min(focus.i, items.length - 1) : 0];
            return (
              <div key={t.id} class="nest-turn" data-res-row={resRow}>
                <div class="nest-msg nest-msg-you">
                  <div class="nest-msg-bubble is-you"><b>{t.prompt}</b></div>
                </div>
                <div class="nest-msg nest-msg-bot">
                  <Orb cls="nest-msg-avatar" />
                  <div class="nest-msg-body">
                    <div class="nest-msg-bubble"><p>{t.reply}</p></div>
                    {items.length > 0 && resRow !== undefined && (
                      <div class="nest-conv-recs">
                        <div class="nest-conv-posters" style={{ height: `${POSTER_H}px` }}>
                          {items.map((r, c) => (
                            <MediaTile
                              key={`${r.type}:${r.title.id}`}
                              x={c * (POSTER_W + POSTER_GAP)}
                              y={0}
                              w={POSTER_W}
                              h={POSTER_H}
                              src={posterUrl(r.title)}
                              badge={c === 0 && t.action === "resume" ? "▶ Resume" : undefined}
                              focused={rowFocused && focus.i === c}
                            />
                          ))}
                        </div>
                        {picked && (
                          <div class={`nest-conv-cap${rowFocused ? " is-focus" : ""}`}>
                            <div class="nest-conv-cap-head">
                              <b>{picked.title.name}</b>
                              <span>
                                {[KIND_TAG[picked.type], picked.title.year, picked.title.rating ? `★ ${picked.title.rating}` : "", t.action === "resume" ? "OK plays" : "OK opens details"]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </span>
                            </div>
                            {picked.title.description && <p>{picked.title.description}</p>}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {asking && (
            <div class="nest-turn is-pending">
              {pendingPrompt && (
                <div class="nest-msg nest-msg-you">
                  <div class="nest-msg-bubble is-you"><b>{pendingPrompt}</b></div>
                </div>
              )}
              <div class="nest-msg nest-msg-bot">
                <Orb cls="nest-msg-avatar" />
                <div class="nest-msg-bubble is-thinking"><p>{status || "Thinking…"}</p></div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div class="nest-conv-foot">
        {chips.length > 0 && (
          <div class="nest-conv-chips">
            {chips.map((c, i) => (
              <Chip key={c} on={focus.zone === "chips" && focus.i === i}>{c}</Chip>
            ))}
          </div>
        )}
        <div class="nest-conv-wave-row">
          <VoiceWave x={0} y={0} w={1920} h={76} state={wave} />
        </div>
        <div class="nest-conv-controls">
          <Chip on={focus.zone === "controls" && focus.i === 0} kind="primary">
            <Orb cls="nest-chip-dot" cool={listening} />
            {listening ? (status || "Listening · OK to finish") : "Speak"}
          </Chip>
          <Chip on={focus.zone === "controls" && focus.i === 1}>Type question</Chip>
          {canSpeak && (
            <Chip on={focus.zone === "controls" && focus.i === 2}>
              {speakOn ? "🔊 Voice replies: On" : "🔇 Voice replies: Off"}
            </Chip>
          )}
          {status && !listening && <span class="nest-conv-state">{status}</span>}
        </div>
      </div>
    </div>
  );
}
