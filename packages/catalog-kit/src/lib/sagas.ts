// The app's own curated sagas and timelines (story and release order), kept for the upcoming Discover page. They no
// longer have home rows: the home shows the profile's Nuvio collections (lib/nuviocollections.ts). The detail page
// still links a title to its saga, which opens ui/SagaTimeline.tsx. Stored keys keep their old names.
import { readJson, writeJson } from "@secretary/tv-kit";
import { getTmdbKey } from "./cinemeta.ts";
import { loadWatchedIds } from "./resume.ts";
import type { CatalogType, HomeRow, Title } from "./types.ts";

export type TimelineOrderMode = "chronological" | "release";

export interface SagaStepDef {
  id: string;
  name: string;
  year: string;
  rating: string;
  runtimeMin: number;
  catalogType: CatalogType;
  /** Position in the narrative / chronological watch order (1-based). */
  chronologicalRank: number;
  /** Position in the theatrical / broadcast release order (1-based). */
  releaseRank: number;
  /** In-universe era or timeline marker (e.g. "Year 2093" or "Step 1 · Awakening"). */
  eraLabel: string;
  /** Nuvio .porque explainability note: why this step sits here in the timeline. */
  curatorNote: string;
  poster?: string;
  background?: string;
}

export interface SagaDef {
  id: string;
  title: string;
  subtitle: string;
  kicker: string;
  type: CatalogType;
  steps: readonly SagaStepDef[];
}

export interface ComputedSagaStep extends SagaStepDef {
  /** 1-based step index in the currently selected order mode. */
  stepNumber: number;
  watched: boolean;
  /** True for the first unwatched step in the sequence. */
  isNext: boolean;
  titleObj: Title;
}

export interface ComputedSagaView {
  collection: SagaDef;
  orderMode: TimelineOrderMode;
  steps: ComputedSagaStep[];
  watchedCount: number;
  totalCount: number;
  progressPct: number;
  /** Index of the first unwatched step, or 0 if all steps are watched. */
  nextStepIndex: number;
  nextStep: ComputedSagaStep;
  remainingMinutes: number;
  totalMinutes: number;
  yearSpan: string;
}

const PINNED_KEY_PREFIX = "sectv.pinnedCollections.v1.";

const DEFAULT_PINNED_BY_TYPE: Record<CatalogType, readonly string[]> = {
  movie: ["matrix-saga"],
  series: ["gilligan-universe"],
  anime: ["aot-journey"],
};

export const CURATED_SAGAS: readonly SagaDef[] = [
  // --- MOVIES ---
  {
    id: "matrix-saga",
    title: "The Matrix Saga",
    subtitle: "Complete Cyberpunk Timeline · Chronological Story Order vs. Release",
    kicker: "SAGA TIMELINE · 5 FILMS",
    type: "movie",
    steps: [
      {
        id: "tt0133093",
        name: "The Matrix",
        year: "1999",
        rating: "8.7",
        runtimeMin: 136,
        catalogType: "movie",
        chronologicalRank: 1,
        releaseRank: 1,
        eraLabel: "Act I · Awakening (1999 Sim)",
        curatorNote:
          "Begins the timeline inside the 1999 neural simulation as Thomas Anderson is freed by Morpheus and Trinity aboard the Nebuchadnezzar.",
      },
      {
        id: "tt0328832",
        name: "The Animatrix",
        year: "2003",
        rating: "7.3",
        runtimeMin: 102,
        catalogType: "movie",
        chronologicalRank: 2,
        releaseRank: 3,
        eraLabel: "Bridge · Machine War & Osiris",
        curatorNote:
          "Placed before Reloaded in story order: 'The Second Renaissance' chronicles the Machine War, while 'Final Flight of the Osiris' delivers the warning that starts Reloaded.",
      },
      {
        id: "tt0234215",
        name: "The Matrix Reloaded",
        year: "2003",
        rating: "7.2",
        runtimeMin: 138,
        catalogType: "movie",
        chronologicalRank: 3,
        releaseRank: 2,
        eraLabel: "Act II · The Prophecy & Architect",
        curatorNote:
          "Follows directly from the Osiris transmission as 250,000 Sentinels bore toward Zion and Neo reaches the Source.",
      },
      {
        id: "tt0242653",
        name: "The Matrix Revolutions",
        year: "2003",
        rating: "6.7",
        runtimeMin: 129,
        catalogType: "movie",
        chronologicalRank: 4,
        releaseRank: 4,
        eraLabel: "Act III · Siege of Zion",
        curatorNote:
          "Starts minutes after Reloaded's cliffhanger as Zion defends the dock and Neo journeys to the Machine City to broker peace.",
      },
      {
        id: "tt10838180",
        name: "The Matrix Resurrections",
        year: "2021",
        rating: "5.7",
        runtimeMin: 148,
        catalogType: "movie",
        chronologicalRank: 5,
        releaseRank: 5,
        eraLabel: "Epilogue · The Seventh Cycle",
        curatorNote:
          "Set sixty years after Revolutions inside the Analyst's new Matrix, reuniting Neo and Trinity in IO's era.",
      },
    ],
  },
  {
    id: "dune-saga",
    title: "Dune: Arrakis Chronicle",
    subtitle: "Villeneuve's Duology & The 1984 Classic · Desert Prophecy",
    kicker: "SAGA TIMELINE · 3 FILMS",
    type: "movie",
    steps: [
      {
        id: "tt1160419",
        name: "Dune: Part One",
        year: "2021",
        rating: "8.0",
        runtimeMin: 155,
        catalogType: "movie",
        chronologicalRank: 1,
        releaseRank: 2,
        eraLabel: "10191 AG · Fall of House Atreides",
        curatorNote:
          "Start here for the modern canonical adaptation: House Atreides takes stewardship of Arrakis and Paul escapes into the deep desert.",
      },
      {
        id: "tt15239678",
        name: "Dune: Part Two",
        year: "2024",
        rating: "8.5",
        runtimeMin: 166,
        catalogType: "movie",
        chronologicalRank: 2,
        releaseRank: 3,
        eraLabel: "10191–10193 AG · Rise of Muad'Dib",
        curatorNote:
          "Continues immediately in the Fremen sietches as Paul masters the sandworms and challenges the Padishah Emperor.",
      },
      {
        id: "tt0087182",
        name: "Dune (1984)",
        year: "1984",
        rating: "6.3",
        runtimeMin: 137,
        catalogType: "movie",
        chronologicalRank: 3,
        releaseRank: 1,
        eraLabel: "Classic Vault · David Lynch Vision",
        curatorNote:
          "In curated order, watch David Lynch's surreal 1984 adaptation as a retrospective companion after completing the modern two-part epic.",
      },
    ],
  },
  {
    id: "middle-earth",
    title: "Middle-earth: The One Ring",
    subtitle: "Third Age Chronology (The Hobbit → The Lord of the Rings)",
    kicker: "SAGA TIMELINE · 6 FILMS",
    type: "movie",
    steps: [
      {
        id: "tt0903624",
        name: "The Hobbit: An Unexpected Journey",
        year: "2012",
        rating: "7.8",
        runtimeMin: 169,
        catalogType: "movie",
        chronologicalRank: 1,
        releaseRank: 4,
        eraLabel: "TA 2941 · Riddles in the Dark",
        curatorNote:
          "Chronological start of the Third Age saga: sixty years before Frodo's quest, Bilbo Baggins finds the One Ring beneath the Misty Mountains.",
      },
      {
        id: "tt1170358",
        name: "The Hobbit: The Desolation of Smaug",
        year: "2013",
        rating: "7.8",
        runtimeMin: 161,
        catalogType: "movie",
        chronologicalRank: 2,
        releaseRank: 5,
        eraLabel: "TA 2941 · Erebor & Dol Guldur",
        curatorNote:
          "Thorin's company enters the Lonely Mountain while Gandalf discovers Sauron's return as the Necromancer.",
      },
      {
        id: "tt2310332",
        name: "The Hobbit: The Battle of the Five Armies",
        year: "2014",
        rating: "7.4",
        runtimeMin: 144,
        catalogType: "movie",
        chronologicalRank: 3,
        releaseRank: 6,
        eraLabel: "TA 2941 · War for the Mountain",
        curatorNote:
          "Concludes the Erebor campaign and bridges directly to Bilbo's 111th birthday in the Shire.",
      },
      {
        id: "tt0120737",
        name: "The Lord of the Rings: The Fellowship of the Ring",
        year: "2001",
        rating: "8.9",
        runtimeMin: 178,
        catalogType: "movie",
        chronologicalRank: 4,
        releaseRank: 1,
        eraLabel: "TA 3018 · Council of Elrond",
        curatorNote:
          "First in theatrical release, fourth in Third Age chronology: Frodo inherits Bilbo's Ring and sets out from Rivendell.",
      },
      {
        id: "tt0167261",
        name: "The Lord of the Rings: The Two Towers",
        year: "2002",
        rating: "8.8",
        runtimeMin: 179,
        catalogType: "movie",
        chronologicalRank: 5,
        releaseRank: 2,
        eraLabel: "TA 3019 · Battle of Helm's Deep",
        curatorNote:
          "The divided Fellowship rallies Rohan at Helm's Deep while Gollum leads Frodo and Sam toward Mordor.",
      },
      {
        id: "tt0167260",
        name: "The Lord of the Rings: The Return of the King",
        year: "2003",
        rating: "9.0",
        runtimeMin: 201,
        catalogType: "movie",
        chronologicalRank: 6,
        releaseRank: 3,
        eraLabel: "TA 3019 · Mount Doom & The Grey Havens",
        curatorNote:
          "The culmination of the entire six-film journey at Pelennor Fields and the Cracks of Doom.",
      },
    ],
  },
  {
    id: "alien-chronology",
    title: "Alien: Xenomorph Timeline",
    subtitle: "In-Universe Weyland-Yutani Chronology (2093 – 2179)",
    kicker: "SAGA TIMELINE · 5 FILMS",
    type: "movie",
    steps: [
      {
        id: "tt1446714",
        name: "Prometheus",
        year: "2012",
        rating: "7.0",
        runtimeMin: 124,
        catalogType: "movie",
        chronologicalRank: 1,
        releaseRank: 3,
        eraLabel: "Year 2093 · LV-223 Expedition",
        curatorNote:
          "Earliest entry on the in-universe timeline (2093): the USCSS Prometheus uncovers the Engineers' black pathogen.",
      },
      {
        id: "tt2316204",
        name: "Alien: Covenant",
        year: "2017",
        rating: "6.4",
        runtimeMin: 122,
        catalogType: "movie",
        chronologicalRank: 2,
        releaseRank: 4,
        eraLabel: "Year 2104 · Planet 4",
        curatorNote:
          "Set eleven years after Prometheus as the colony ship Covenant encounters David's genetic Xenomorph experiments.",
      },
      {
        id: "tt0078748",
        name: "Alien",
        year: "1979",
        rating: "8.5",
        runtimeMin: 117,
        catalogType: "movie",
        chronologicalRank: 3,
        releaseRank: 1,
        eraLabel: "Year 2122 · USCSS Nostromo",
        curatorNote:
          "Ridley Scott's 1979 landmark: in 2122, Ellen Ripley and the Nostromo crew answer the distress beacon on LV-426.",
      },
      {
        id: "tt18412256",
        name: "Alien: Romulus",
        year: "2024",
        rating: "7.2",
        runtimeMin: 119,
        catalogType: "movie",
        chronologicalRank: 4,
        releaseRank: 5,
        eraLabel: "Year 2142 · Renaissance Station",
        curatorNote:
          "Takes place twenty years after the Nostromo disaster aboard a drifting Weyland-Yutani research orbital.",
      },
      {
        id: "tt0090605",
        name: "Aliens",
        year: "1986",
        rating: "8.4",
        runtimeMin: 137,
        catalogType: "movie",
        chronologicalRank: 5,
        releaseRank: 2,
        eraLabel: "Year 2179 · Hadley's Hope",
        curatorNote:
          "Fifty-seven years after Alien, Ripley returns to LV-426 with Colonial Marines to confront the Queen.",
      },
    ],
  },

  // --- SERIES ---
  {
    id: "gilligan-universe",
    title: "Albuquerque Crime Timeline",
    subtitle: "Better Call Saul → Breaking Bad → El Camino (2002 – 2010)",
    kicker: "UNIVERSE TIMELINE · 3 ENTRIES",
    type: "series",
    steps: [
      {
        id: "tt3032476",
        name: "Better Call Saul",
        year: "2015",
        rating: "9.0",
        runtimeMin: 3100,
        catalogType: "series",
        chronologicalRank: 1,
        releaseRank: 2,
        eraLabel: "2002–2004 · Jimmy McGill Era",
        curatorNote:
          "Chronological foundation (2002): traces Jimmy McGill's evolution into Saul Goodman and Gus Fring's secret superlab construction.",
      },
      {
        id: "tt0903747",
        name: "Breaking Bad",
        year: "2008",
        rating: "9.5",
        runtimeMin: 3038,
        catalogType: "series",
        chronologicalRank: 2,
        releaseRank: 1,
        eraLabel: "2008–2010 · Rise of Heisenberg",
        curatorNote:
          "2008–2010: Walter White and Jesse Pinkman enter Saul's orbit and dismantle the cartel hierarchy.",
      },
      {
        id: "tt9243946",
        name: "El Camino: A Breaking Bad Movie",
        year: "2019",
        rating: "7.3",
        runtimeMin: 122,
        catalogType: "movie",
        chronologicalRank: 3,
        releaseRank: 3,
        eraLabel: "2010 Epilogue · Jesse's Escape",
        curatorNote:
          "Starts seconds after the Breaking Bad series finale as Jesse Pinkman seeks freedom in Haines, Alaska.",
      },
    ],
  },
  {
    id: "westeros-chronology",
    title: "Westeros: Fire & Ice Timeline",
    subtitle: "Targaryen Dynasty to the War of the Five Kings (112 AC – 305 AC)",
    kicker: "UNIVERSE TIMELINE · 2 SERIES",
    type: "series",
    steps: [
      {
        id: "tt11198330",
        name: "House of the Dragon",
        year: "2022",
        rating: "8.4",
        runtimeMin: 1080,
        catalogType: "series",
        chronologicalRank: 1,
        releaseRank: 2,
        eraLabel: "112–130 AC · Dance of the Dragons",
        curatorNote:
          "Set 172 years before Daenerys Targaryen's birth at the height of Targaryen dragon power.",
      },
      {
        id: "tt0944947",
        name: "Game of Thrones",
        year: "2011",
        rating: "9.2",
        runtimeMin: 4160,
        catalogType: "series",
        chronologicalRank: 2,
        releaseRank: 1,
        eraLabel: "298–305 AC · The Iron Throne",
        curatorNote:
          "Nearly two centuries later, the noble houses of Westeros clash for the Iron Throne as winter descends.",
      },
    ],
  },
  {
    id: "boys-universe",
    title: "Vought International Timeline",
    subtitle: "The Boys & Gen V Interconnected Supes Chronology",
    kicker: "UNIVERSE TIMELINE · 2 SERIES",
    type: "series",
    steps: [
      {
        id: "tt1190634",
        name: "The Boys",
        year: "2019",
        rating: "8.7",
        runtimeMin: 1920,
        catalogType: "series",
        chronologicalRank: 1,
        releaseRank: 1,
        eraLabel: "Phase I · Butcher vs. The Seven",
        curatorNote:
          "Billy Butcher's vigilante squad exposes Compound V and Homelander's grip on Vought International.",
      },
      {
        id: "tt13159924",
        name: "Gen V",
        year: "2023",
        rating: "7.7",
        runtimeMin: 400,
        catalogType: "series",
        chronologicalRank: 2,
        releaseRank: 2,
        eraLabel: "Phase II · Godolkin University & The Woods",
        curatorNote:
          "Bridges Seasons 3 and 4 of The Boys, revealing the anti-Supe virus researched beneath Godolkin University.",
      },
    ],
  },

  // --- ANIME ---
  {
    id: "aot-journey",
    title: "Dark Fantasy Titans & Alchemy",
    subtitle: "Essential Epic Anime Journey · Curated Progression",
    kicker: "CURATED TIMELINE · 3 ANIME",
    type: "anime",
    steps: [
      {
        id: "tt2560140",
        name: "Attack on Titan",
        year: "2013",
        rating: "9.1",
        runtimeMin: 2250,
        catalogType: "anime",
        chronologicalRank: 1,
        releaseRank: 2,
        eraLabel: "Step 1 · Fall of Shiganshina to The Rumbling",
        curatorNote:
          "Anchor of the dark-fantasy journey: four seasons of escalating mystery from inside the Walls to Marley.",
      },
      {
        id: "tt20778062",
        name: "Vinland Saga",
        year: "2019",
        rating: "8.8",
        runtimeMin: 1152,
        catalogType: "anime",
        chronologicalRank: 2,
        releaseRank: 3,
        eraLabel: "Step 2 · Vengeance to Redemption",
        curatorNote:
          "Follow Attack on Titan with Thorfinn's philosophical arc from warrior vengeance to building a land without war.",
      },
      {
        id: "tt0434665",
        name: "Fullmetal Alchemist: Brotherhood",
        year: "2009",
        rating: "9.1",
        runtimeMin: 1536,
        catalogType: "anime",
        chronologicalRank: 3,
        releaseRank: 1,
        eraLabel: "Step 3 · The Promised Day",
        curatorNote:
          "Complete the triad with the gold standard of conspiracy, sacrifice, and hopeful resolution.",
      },
    ],
  },
  {
    id: "cyberpunk-anime",
    title: "Cyberpunk & Net Consciousness",
    subtitle: "Evolution of Sci-Fi Anime (1988 Neo-Tokyo → 2077 Night City)",
    kicker: "CHRONOLOGICAL TIMELINE · 3 TITLES",
    type: "anime",
    steps: [
      {
        id: "tt0094625",
        name: "Akira",
        year: "1988",
        rating: "8.0",
        runtimeMin: 124,
        catalogType: "movie",
        chronologicalRank: 1,
        releaseRank: 1,
        eraLabel: "1988 · Neo-Tokyo Awakening",
        curatorNote:
          "Katsuhiro Otomo's hand-drawn milestone that established the visual grammar of cyberpunk.",
      },
      {
        id: "tt0113568",
        name: "Ghost in the Shell",
        year: "1995",
        rating: "7.9",
        runtimeMin: 83,
        catalogType: "movie",
        chronologicalRank: 2,
        releaseRank: 2,
        eraLabel: "1995 · Section 9 & The Net",
        curatorNote:
          "Mamoru Oshii's philosophical investigation into cybernetic identity and the Ghost inside the machine.",
      },
      {
        id: "tt12590266",
        name: "Cyberpunk: Edgerunners",
        year: "2022",
        rating: "8.3",
        runtimeMin: 240,
        catalogType: "anime",
        chronologicalRank: 3,
        releaseRank: 3,
        eraLabel: "2022 · Night City Chrome",
        curatorNote:
          "Studio Trigger's high-voltage culmination of the genre on the streets of Night City.",
      },
    ],
  },
];

export function sagasForType(type: CatalogType): readonly SagaDef[] {
  return CURATED_SAGAS.filter((c) => c.type === type);
}

export function getSagaById(id: string): SagaDef | undefined {
  return CURATED_SAGAS.find((c) => c.id === id);
}

export function findSagaForTitle(titleId: string, type?: CatalogType): SagaDef | undefined {
  if (!titleId) return undefined;
  const preferred = type ? CURATED_SAGAS.filter((c) => c.type === type) : CURATED_SAGAS;
  for (const col of preferred) {
    if (col.steps.some((s) => s.id === titleId)) return col;
  }
  for (const col of CURATED_SAGAS) {
    if (col.steps.some((s) => s.id === titleId)) return col;
  }
  return undefined;
}

export function loadPinnedSagaIds(type: CatalogType): string[] {
  const saved = readJson<string[]>(`${PINNED_KEY_PREFIX}${type}`);
  if (Array.isArray(saved)) {
    return saved.filter((id): id is string => typeof id === "string" && id.length > 0);
  }
  return [...DEFAULT_PINNED_BY_TYPE[type]];
}

export function isSagaPinned(type: CatalogType, sagaId: string): boolean {
  return loadPinnedSagaIds(type).includes(sagaId);
}

export function togglePinSaga(type: CatalogType, sagaId: string): boolean {
  const current = new Set(loadPinnedSagaIds(type));
  const nextPinned = !current.has(sagaId);
  if (nextPinned) current.add(sagaId);
  else current.delete(sagaId);
  writeJson(`${PINNED_KEY_PREFIX}${type}`, [...current]);
  return nextPinned;
}

export function formatRemainingRuntime(minutes: number): string {
  if (minutes <= 0) return "Completed";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function computeSagaView(
  collection: SagaDef,
  orderMode: TimelineOrderMode = "chronological",
  watchedIds: readonly string[] = loadWatchedIds(),
): ComputedSagaView {
  const watchedSet = new Set(watchedIds);
  const sorted = [...collection.steps].sort((a, b) => {
    if (orderMode === "release") {
      if (a.releaseRank !== b.releaseRank) return a.releaseRank - b.releaseRank;
      return a.year.localeCompare(b.year);
    }
    return a.chronologicalRank - b.chronologicalRank;
  });

  let firstUnwatchedIdx = sorted.findIndex((s) => !watchedSet.has(s.id));
  const allWatched = firstUnwatchedIdx === -1;
  if (allWatched) firstUnwatchedIdx = 0;

  let watchedCount = 0;
  let remainingMinutes = 0;
  let totalMinutes = 0;
  const years: number[] = [];

  const steps: ComputedSagaStep[] = sorted.map((s, idx) => {
    const watched = watchedSet.has(s.id);
    const isNext = !allWatched && idx === firstUnwatchedIdx;
    if (watched) watchedCount++;
    else remainingMinutes += s.runtimeMin;
    totalMinutes += s.runtimeMin;
    const y = Number.parseInt(s.year, 10);
    if (!Number.isNaN(y)) years.push(y);

    const stepNumber = idx + 1;
    const titleObj: Title = {
      id: s.id,
      name: s.name,
      year: s.year,
      rating: s.rating,
      runtime: `${s.runtimeMin} min`,
      description: s.curatorNote,
      poster: s.poster,
      background: s.background,
      catalogType: s.catalogType,
      sequenceNum: stepNumber,
      watched,
      isNextStep: isNext,
      badge: isNext ? "NEXT" : watched ? "✓ Watched" : `Step ${stepNumber}`,
    };

    return {
      ...s,
      stepNumber,
      watched,
      isNext,
      titleObj,
    };
  });

  const totalCount = steps.length || 1;
  const progressPct = Math.round((watchedCount / totalCount) * 100);
  const minYear = years.length ? Math.min(...years) : "";
  const maxYear = years.length ? Math.max(...years) : "";
  const yearSpan = minYear && maxYear ? (minYear === maxYear ? `${minYear}` : `${minYear} – ${maxYear}`) : "";

  return {
    collection,
    orderMode,
    steps,
    watchedCount,
    totalCount: steps.length,
    progressPct,
    nextStepIndex: firstUnwatchedIdx,
    nextStep: steps[firstUnwatchedIdx] ?? steps[0],
    remainingMinutes,
    totalMinutes,
    yearSpan,
  };
}

/**
 * Builds the Nuvio 1B "Collections & Timelines" HomeRow where each item is a wide .col island card
 * with fanned posters (.leque) and a live progress bar (.trilho).
 */
export function buildSagasRow(
  type: CatalogType,
  watchedIds: readonly string[] = loadWatchedIds(),
): HomeRow {
  const cols = sagasForType(type);
  const items: Title[] = cols.map((col) => {
    const view = computeSagaView(col, "chronological", watchedIds);
    const nextLabel =
      view.watchedCount >= view.totalCount
        ? `All ${view.totalCount} completed`
        : `${view.watchedCount} of ${view.totalCount} watched · Next: ${view.nextStep?.name ?? ""}`;
    return {
      id: `col:${col.id}`,
      sagaId: col.id,
      name: col.title,
      year: view.yearSpan,
      rating: view.nextStep?.rating ?? "",
      description: col.subtitle,
      catalogType: type,
      badge: nextLabel,
      progressPct: Math.max(6, view.progressPct),
      poster: view.steps[0]?.poster,
    };
  });

  return {
    id: "collections",
    title: "Sagas & Timelines",
    rowKind: "collections",
    originLabel: "Interactive Saga Timelines · Story & Release Order",
    items,
  };
}

/**
 * Builds any Pinned Collection Timeline rows for the Home screen (Nuvio 1B pinned collection row
 * with .num sequence numbers, .visto watched checkmarks, and .prox "NEXT" pill).
 */
export function buildPinnedSagaRows(
  type: CatalogType,
  watchedIds: readonly string[] = loadWatchedIds(),
): HomeRow[] {
  const pinnedIds = loadPinnedSagaIds(type);
  const out: HomeRow[] = [];
  for (const id of pinnedIds) {
    const col = getSagaById(id);
    if (!col || col.type !== type) continue;
    const view = computeSagaView(col, "chronological", watchedIds);
    out.push({
      id: `timeline:${col.id}`,
      sagaId: col.id,
      title: `${col.title} · Timeline`,
      rowKind: "timeline",
      originLabel: `${view.watchedCount}/${view.totalCount} Watched · Story Order`,
      items: view.steps.map((s) => s.titleObj),
    });
  }
  return out;
}

interface TmdbCollectionPart {
  id?: number;
  title?: string;
  release_date?: string;
  vote_average?: number;
  overview?: string;
  poster_path?: string;
  backdrop_path?: string;
}

interface TmdbCollectionResponse {
  id?: number;
  name?: string;
  overview?: string;
  parts?: TmdbCollectionPart[];
}

interface TmdbExternalIdsResponse {
  imdb_id?: string;
}

/**
 * Fetches a dynamic TMDB Collection when TMDB_API_KEY is configured and converts its parts into
 * an interactive SagaDef timeline.
 */
export async function fetchTmdbCollection(
  tmdbCollectionId: number,
  fallbackName = "Saga Collection",
  tmdbKey = getTmdbKey(),
  f: typeof fetch = fetch,
): Promise<SagaDef | null> {
  if (!tmdbKey || !tmdbCollectionId) return null;
  try {
    const res = await f(
      `https://api.themoviedb.org/3/collection/${tmdbCollectionId}?api_key=${encodeURIComponent(tmdbKey)}`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as TmdbCollectionResponse;
    const rawParts = (data.parts ?? []).filter((p): p is TmdbCollectionPart & { id: number; title: string } =>
      Boolean(p?.id && p?.title),
    );
    if (!rawParts.length) return null;

    // Sort by release date first
    const byRelease = [...rawParts].sort((a, b) =>
      (a.release_date || "9999").localeCompare(b.release_date || "9999"),
    );

    // Resolve external IMDb IDs in parallel
    const resolved = await Promise.all(
      byRelease.map(async (part, idx) => {
        try {
          const extRes = await f(
            `https://api.themoviedb.org/3/movie/${part.id}/external_ids?api_key=${encodeURIComponent(tmdbKey)}`,
          );
          if (!extRes.ok) return null;
          const ext = (await extRes.json()) as TmdbExternalIdsResponse;
          if (!ext.imdb_id?.startsWith("tt")) return null;
          const year = (part.release_date ?? "").slice(0, 4);
          return {
            id: ext.imdb_id,
            name: part.title,
            year: year || "TBA",
            rating: part.vote_average ? part.vote_average.toFixed(1) : "",
            runtimeMin: 125,
            catalogType: "movie" as const,
            chronologicalRank: idx + 1,
            releaseRank: idx + 1,
            eraLabel: year ? `Released ${year}` : `Chapter ${idx + 1}`,
            curatorNote: part.overview || `Chapter ${idx + 1} in ${data.name || fallbackName}.`,
            poster: part.poster_path ? `https://image.tmdb.org/t/p/w342${part.poster_path}` : undefined,
            background: part.backdrop_path ? `https://image.tmdb.org/t/p/w1280${part.backdrop_path}` : undefined,
          } satisfies SagaStepDef;
        } catch {
          return null;
        }
      }),
    );

    const steps = resolved.filter((s): s is NonNullable<typeof s> => s !== null);
    if (!steps.length) return null;

    return {
      id: `tmdb-col-${tmdbCollectionId}`,
      title: data.name || fallbackName,
      subtitle: data.overview || `Complete ${steps.length}-film theatrical saga`,
      kicker: `TMDB SAGA · ${steps.length} FILMS`,
      type: "movie",
      steps,
    };
  } catch {
    return null;
  }
}
