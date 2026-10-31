import { readFileSync } from "node:fs";
import type { Plugin } from "vite";

const watchdog = readFileSync(new URL("../tizen/boot-watchdog.js", import.meta.url), "utf8");

/**
 * The TV loads the build over file://. Rules from docs/lessons.md: relative
 * paths only, no crossorigin attributes, and Samsung's webapis.js added after
 * bundling so Vite never tries to resolve it. Inlines the boot watchdog.
 */
export function tizenHtml(): Plugin {
  return {
    name: "tizen-html",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        const out = html
          .replace(/<(?:script|link)\b[^>]*>/g, (tag) =>
            /\s(?:src|href)="\.\//.test(tag)
              ? tag.replace(/\s+crossorigin(?:=(?:"[^"]*"|'[^']*'))?/, "")
              : tag,
          )
          .replace(
            "<head>",
            `<head>\n<script>\n${watchdog}</script>\n<script src="$WEBAPIS/webapis/webapis.js"></script>`,
          );
        const absolute = out.match(/\s(?:src|href)="\/(?!\/)[^"]*"/g);
        if (absolute) throw new Error(`absolute asset paths break file:// loading: ${absolute.join(", ")}`);
        return out;
      },
    },
  };
}

export const tizenBuild = {
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "chrome120",
    modulePreload: false,
    cssCodeSplit: false,
  },
} as const;
