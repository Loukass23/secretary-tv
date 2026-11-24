// The catalog inside Secretary (docs/embedding-catalog.md): its home, title pages, folders, the Hub and the AVPlay player
// run here as a chunk that loads when the first one opens, so Secretary's own start stays as fast. Preact and plain DOM,
// like the rest of Secretary.
import type { CatalogConfig, EmbeddedHost } from "@secretary/catalog-kit";
import type { ComponentType } from "preact";
import { BirdLoader } from "@secretary/tv-kit/src/glass/index.ts";
import { useEffect, useState } from "preact/hooks";

export interface CatalogEntry {
  type: CatalogConfig["type"];
  /** A title to open on, or a folder of the profile's collections; neither opens the home. */
  open?: CatalogConfig["open"];
  folder?: CatalogConfig["folder"];
  hub?: CatalogConfig["hub"];
}

const HEADING = { movie: "Cinema", series: "Shows", anime: "Anime" } as const;

export function CatalogHost({ entry, host, serverUrl }: { entry: CatalogEntry; host: EmbeddedHost; serverUrl: string }) {
  const [App, setApp] = useState<ComponentType<CatalogConfig> | null>(null);
  useEffect(() => {
    let live = true;
    void import("@secretary/catalog-kit").then((m) => live && setApp(() => m.CatalogApp));
    return () => {
      live = false;
    };
  }, []);
  if (!App) return <div class="nest-catalog-loading"><BirdLoader /></div>;
  // The catalog comes in by opacity, on its own layer, so it feels like the card opening rather than a new page.
  // Keyed by what it opened on: the header's Settings button, pressed on a title page, opens the catalog anew on the Hub.
  const key = `${entry.type}|${entry.open?.title.id ?? ""}|${entry.folder?.folderId ?? ""}|${entry.hub?.tab ?? ""}`;
  return (
    <div class="nest-catalog-in">
      <App key={key} type={entry.type} heading={HEADING[entry.type]} serverUrl={serverUrl} embedded={host} open={entry.open} folder={entry.folder} hub={entry.hub} />
    </div>
  );
}
