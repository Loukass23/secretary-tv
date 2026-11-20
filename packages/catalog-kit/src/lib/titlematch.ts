/**
 * Does a source's text name the title it was asked for? Two shows can share a name ("Monsters" the anime and the
 * series), and a provider only ever gets ids, so the one place to catch the wrong one is the release name that comes
 * back. The answer is careful on purpose: most source labels carry no show name at all (and anime release names use
 * another language's name), so only a release year from before the title began counts against a source.
 */
export type TitleMatch = "exact" | "unknown" | "mismatch";

export interface TitleRef {
  name: string;
  /** The year the catalog gives, "2016" or "2016-2019". */
  year?: string;
}

const squash = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Years in a release name that look like the release year: 19xx or 20xx between separators, not part of 1080p or 2160. */
const YEAR = /(?:^|[\s.(\[_-])((?:19|20)\d{2})(?=$|[\s.)\]_-])/g;

export function releaseYears(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(YEAR)) out.push(Number(m[1]));
  return out;
}

export function titleMatch(text: string, title: TitleRef): TitleMatch {
  const wanted = Number(/\d{4}/.exec(title.year ?? "")?.[0]);
  const years = releaseYears(text);
  const named = squash(` ${text} `).includes(` ${squash(title.name)} `) || squash(text).startsWith(`${squash(title.name)} `);
  // Years all before the title's own (one year of slack: air and release dates differ) name an earlier show. Later
  // years are no evidence: a long series has releases from every season's year.
  if (wanted && years.length && years.every((y) => y < wanted - 1)) return "mismatch";
  return named ? "exact" : "unknown";
}

/** Sort key for rankSources: lower first. */
export const matchRank = (m: TitleMatch): number => (m === "exact" ? 0 : m === "unknown" ? 1 : 2);
