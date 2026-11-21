// The catalog inside Nest (docs/embedding-catalog.md, option B): Home, Detail, folders and search run here as a chunk
// that loads when the first one opens, so Nest's own start is as it was. Playing hands the title to the catalog app,
// which owns the player. Preact and plain DOM, like Nest.
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

const HEADING = { movie: "Secretary Cinema", series: "Secretary Shows", anime: "Secretary Anime" } as const;

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
  return (
    <div class="nest-catalog-in">
      <App type={entry.type} heading={HEADING[entry.type]} serverUrl={serverUrl} returnTo="" embedded={host} open={entry.open} folder={entry.folder} hub={entry.hub} />
    </div>
  );
}
