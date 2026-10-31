import { useKeys, windowOf } from "@secretary/tv-kit";
import { Glass, GlassRoot, MediaTile, Segmented } from "@secretary/tv-kit/src/glass/index.ts";
import { useEffect, useMemo, useState } from "preact/hooks";
import { backgroundUrl, posterUrl } from "../lib/cinemeta.ts";
import {
  type SagaDef,
  computeSagaView,
  formatRemainingRuntime,
  isSagaPinned,
  type TimelineOrderMode,
  togglePinSaga,
} from "../lib/sagas.ts";
import { loadWatchedIds, toggleTitleWatched } from "../lib/resume.ts";
import type { ClockFormat } from "../lib/settings.ts";
import type { CatalogType, Title } from "../lib/types.ts";
import { HeroLayers, useBase, useHeroArt } from "./art.tsx";
import "./timeline.css";

const PAD = 80;
const STEP_W = 200;
const STEP_H = 300;
const STEP_STRIDE = STEP_W + 50;
/** The numbered dots sit above the posters, on the line that joins the steps. */
const BUBBLE_H = 64;
const STEPS_Y = 250;
const SEG = { x: 1040, y: 52, w: 560, h: 68 };
const WHY = { x: PAD, y: 720, w: 1120, h: 300 };
const ABOUT = { x: 1230, y: 720, w: 610, h: 300 };

function formatClock(fmt: ClockFormat): string {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: fmt === "12h",
  });
}

interface Props {
  collection: SagaDef;
  active: boolean;
  clockFormat?: ClockFormat;
  initialFocusTitleId?: string;
  onOpenTitle(type: CatalogType, title: Title, autoPlay?: boolean): void;
  onStateChange(): void;
  onBack(): void;
}

export function SagaTimeline({
  collection,
  active,
  clockFormat = "24h",
  initialFocusTitleId,
  onOpenTitle,
  onStateChange,
  onBack,
}: Props) {
  const [orderMode, setOrderMode] = useState<TimelineOrderMode>("chronological");
  const [watchedIds, setWatchedIds] = useState<string[]>(() => loadWatchedIds());
  const [pinned, setPinned] = useState<boolean>(() =>
    isSagaPinned(collection.type, collection.id),
  );
  const [clockText, setClockText] = useState(() => formatClock(clockFormat));

  const view = useMemo(
    () => computeSagaView(collection, orderMode, watchedIds),
    [collection, orderMode, watchedIds],
  );

  // Focus zones:
  // zone "steps" (default): navigating Left/Right across timeline steps
  // zone "order": top-right segmented pill bar (0 = Chronological, 1 = Release)
  // zone "actions": bottom .porque action pills (0 = Play Step, 1 = Open Details, 2 = Toggle Watched, 3 = Pin to Discover)
  const [zone, setZone] = useState<"order" | "steps" | "actions">("steps");
  const [stepIdx, setStepIdx] = useState<number>(() => {
    if (initialFocusTitleId) {
      const idx = view.steps.findIndex((s) => s.id === initialFocusTitleId);
      if (idx >= 0) return idx;
    }
    return view.nextStepIndex;
  });
  const [orderCol, setOrderCol] = useState<number>(0);
  const [actionCol, setActionCol] = useState<number>(0);

  useEffect(() => {
    setClockText(formatClock(clockFormat));
    const t = setInterval(() => setClockText(formatClock(clockFormat)), 30_000);
    return () => clearInterval(t);
  }, [clockFormat]);

  // Refresh watched state when view becomes active again (e.g. returning from Detail/Player).
  useEffect(() => {
    if (!active) return;
    setWatchedIds(loadWatchedIds());
    setPinned(isSagaPinned(collection.type, collection.id));
  }, [active, collection.id, collection.type]);

  // Clamp stepIdx if collection changes.
  useEffect(() => {
    if (stepIdx >= view.steps.length) {
      setStepIdx(Math.max(0, view.steps.length - 1));
    }
  }, [view.steps.length, stepIdx]);

  const focusedStep = view.steps[stepIdx] ?? view.steps[0];
  const base = useBase(collection.type);
  // The focused step's art becomes the backdrop once focus rests on it.
  const hero = useHeroArt(focusedStep?.id, focusedStep ? backgroundUrl(focusedStep.titleObj) : undefined, active);

  const handleToggleWatched = () => {
    if (!focusedStep) return;
    toggleTitleWatched(focusedStep.id);
    setWatchedIds(loadWatchedIds());
    onStateChange();
  };

  const handleTogglePin = () => {
    const next = togglePinSaga(collection.type, collection.id);
    setPinned(next);
    onStateChange();
  };

  const switchOrder = (mode: TimelineOrderMode) => {
    const currentId = focusedStep?.id;
    setOrderMode(mode);
    setOrderCol(mode === "chronological" ? 0 : 1);
    if (currentId) {
      const recomputed = computeSagaView(collection, mode, watchedIds);
      const nextIdx = recomputed.steps.findIndex((s) => s.id === currentId);
      if (nextIdx >= 0) setStepIdx(nextIdx);
    }
  };

  useKeys(active, (key) => {
    if (key === "Back") {
      onBack();
      return;
    }

    if (zone === "order") {
      if (key === "Down") {
        setZone("steps");
        return;
      }
      if (key === "Left") {
        switchOrder("chronological");
        return;
      }
      if (key === "Right") {
        switchOrder("release");
        return;
      }
      if (key === "Enter") {
        switchOrder(orderCol === 0 ? "chronological" : "release");
        setZone("steps");
        return;
      }
      return false;
    }

    if (zone === "steps") {
      if (key === "Left") {
        setStepIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (key === "Right") {
        setStepIdx((i) => Math.min(view.steps.length - 1, i + 1));
        return;
      }
      if (key === "Up") {
        setOrderCol(orderMode === "chronological" ? 0 : 1);
        setZone("order");
        return;
      }
      if (key === "Down") {
        setActionCol(0);
        setZone("actions");
        return;
      }
      if (key === "Enter") {
        if (focusedStep) {
          onOpenTitle(focusedStep.catalogType, focusedStep.titleObj, false);
        }
        return;
      }
      return false;
    }

    // zone === "actions"
    if (key === "Up") {
      setZone("steps");
      return;
    }
    if (key === "Left") {
      setActionCol((c) => Math.max(0, c - 1));
      return;
    }
    if (key === "Right") {
      setActionCol((c) => Math.min(3, c + 1));
      return;
    }
    if (key === "Enter") {
      if (!focusedStep) return;
      if (actionCol === 0) {
        onOpenTitle(focusedStep.catalogType, focusedStep.titleObj, true);
      } else if (actionCol === 1) {
        onOpenTitle(focusedStep.catalogType, focusedStep.titleObj, false);
      } else if (actionCol === 2) {
        handleToggleWatched();
      } else if (actionCol === 3) {
        handleTogglePin();
      }
      return;
    }
    return false;
  });

  const [from, to] = windowOf(stepIdx, view.steps.length, 2, 6);
  const shift = Math.max(0, stepIdx - 2) * STEP_STRIDE;

  // The line through the step numbers: filled up to the next unwatched step, or all the way when done.
  const totalTrackWidth = Math.max(1, (view.steps.length - 1) * STEP_STRIDE);
  const completedIdx = view.watchedCount >= view.totalCount ? view.steps.length - 1 : view.nextStepIndex;
  const filledTrackWidth = Math.min(totalTrackWidth, Math.max(0, completedIdx * STEP_STRIDE));
  const actions = focusedStep
    ? [
        `▶ Play step ${focusedStep.stepNumber}`,
        "Title details",
        focusedStep.watched ? "✓ Watched" : "Mark watched",
        pinned ? "★ Pinned to Discover" : "☆ Pin to Discover",
      ]
    : [];

  return (
    <div class="timeline-glass" style={active ? undefined : "display:none"}>
      <GlassRoot mode="fake" wallpaper={base.backdrop?.wallpaper} frost={hero.frost ?? base.backdrop?.frost} class="tl">
        <HeroLayers hero={hero} shade={base.shade} />

        <div class="tl-head" style={{ left: `${PAD}px`, top: "44px" }}>
          <span class="cat-kicker">
            {collection.kicker} · {orderMode === "chronological" ? "story order" : "release order"}
          </span>
          <h1>{collection.title}</h1>
          <p>{collection.subtitle}</p>
        </div>
        <Segmented
          {...SEG}
          items={[`Story order · 1–${view.totalCount}`, `Release · ${view.yearSpan}`]}
          picked={orderMode === "chronological" ? 0 : 1}
          focusIndex={zone === "order" ? orderCol : -1}
        />
        <div class="tl-clock">{clockText}</div>

        <div class="sg-clip" style={{ left: "0px", top: `${STEPS_Y - 20}px`, width: "1920px", height: "470px" }}>
          <div class="sg-scroll" style={{ transform: `translate3d(${PAD - shift}px,20px,0)` }}>
            {view.steps.length > 1 && (
              <>
                <i class="tl-line" style={{ left: `${STEP_W / 2}px`, width: `${totalTrackWidth}px` }} />
                <i class="tl-line is-done" style={{ left: `${STEP_W / 2}px`, width: `${filledTrackWidth}px` }} />
              </>
            )}
            {view.steps.slice(from, to).map((step, k) => {
              const idx = from + k;
              const state = step.watched ? " is-watched" : step.isNext ? " is-next" : "";
              return (
                <div key={step.id} class={`tl-step${state}`} style={{ left: `${idx * STEP_STRIDE}px` }}>
                  <span class="tl-dot">{step.watched ? "✓" : step.stepNumber}</span>
                  <MediaTile
                    x={0}
                    y={BUBBLE_H}
                    w={STEP_W}
                    h={STEP_H}
                    src={posterUrl(step.titleObj)}
                    badge={step.isNext ? "Next" : undefined}
                    focused={zone === "steps" && idx === stepIdx}
                  />
                  <b>{step.name}</b>
                  <small>
                    {step.year} · {step.runtimeMin >= 180 && step.catalogType !== "movie" ? "Series" : `${step.runtimeMin}m`}
                  </small>
                </div>
              );
            })}
          </div>
        </div>

        {focusedStep && (
          <>
            <Glass {...WHY} class="tl-why">
              <span class="cat-kicker">
                Step {focusedStep.stepNumber} of {view.totalCount} · {focusedStep.eraLabel}
                {focusedStep.isNext ? " · up next" : focusedStep.watched ? " · watched" : ""}
              </span>
              <h2>{focusedStep.name}</h2>
              <div class="cat-meta">
                {[focusedStep.rating && `IMDb ${focusedStep.rating}`, focusedStep.year, `${focusedStep.runtimeMin} min`, focusedStep.catalogType]
                  .filter(Boolean)
                  .join("  ·  ")}
              </div>
              <p>{focusedStep.curatorNote}</p>
              <div class="tl-actions">
                {actions.map((label, i) => (
                  <span key={i} class={`cat-btn${i === 0 ? " is-primary" : ""}${zone === "actions" && actionCol === i ? " is-focus" : ""}`}>
                    {label}
                  </span>
                ))}
              </div>
            </Glass>

            <Glass {...ABOUT} class="tl-about">
              <span class="cat-kicker">Saga progress</span>
              <h3>
                {view.watchedCount} of {view.totalCount} watched
              </h3>
              <span class="cat-bar">
                <i style={{ transform: `scaleX(${Math.max(0.04, view.progressPct / 100)})` }} />
              </span>
              <div class="tl-grid">
                <div>
                  <small>Next step</small>
                  <b>{view.watchedCount >= view.totalCount ? "Completed ✓" : `#${view.nextStep.stepNumber} ${view.nextStep.name}`}</b>
                </div>
                <div>
                  <small>Remaining</small>
                  <b>{formatRemainingRuntime(view.remainingMinutes)}</b>
                </div>
                <div>
                  <small>Era span</small>
                  <b>{view.yearSpan}</b>
                </div>
                <div>
                  <small>Home</small>
                  <b>{pinned ? "Pinned in Discover" : "Sagas"}</b>
                </div>
              </div>
            </Glass>
          </>
        )}
      </GlassRoot>
    </div>
  );
}
