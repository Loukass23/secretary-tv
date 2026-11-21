// One calm line for the detail page while the plugins look for sources, instead of every provider's own state. Pure, so it
// is unit tested.
import type { ProviderStatus } from "@secretary/plugins";

export function searchSummary(status: readonly Pick<ProviderStatus, "state" | "count">[]): string {
  if (!status.length) return "";
  const waiting = status.filter((p) => p.state === "searching").length;
  const failed = status.filter((p) => p.state === "error").length;
  const found = status.reduce((n, p) => n + p.count, 0);
  const tail = failed ? ` · ${failed} could not be reached` : "";
  if (waiting === 0) return `${found} source${found === 1 ? "" : "s"} found${tail}`;
  return `Searching · ${status.length - waiting} of ${status.length} answered${found ? ` · ${found} found so far` : ""}${tail}`;
}
