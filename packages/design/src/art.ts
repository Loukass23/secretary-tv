// Placeholder artwork drawn on canvases at boot, so the workbench needs no network and shows no real titles.
// Gradients are fine here: they are painted once into a bitmap, as wallpaper.ts does on the TV.
import { blob, canvas, glow } from "@secretary/tv-kit/src/glass/index.ts";

/** Hues for the placeholder art, one per title. */
const HUES = [18, 210, 340, 160, 45, 265, 190, 0, 120, 300, 30, 230];

export interface Art {
  posters: string[];
  backgrounds: string[];
  /** Landscape stills for tiles and episodes. */
  stills: string[];
  icons: string[];
  /** Stylized title logos on transparency, as Fanart.tv gives them (titleArt's `logo`). */
  logos: string[];
}

function poster(i: number, title: string): HTMLCanvasElement {
  const [c, g] = canvas(300, 450);
  const h = HUES[i % HUES.length];
  g.fillStyle = `hsl(${h} 35% 14%)`;
  g.fillRect(0, 0, 300, 450);
  glow(g, 80 + (i * 53) % 160, 120, 260, `hsla(${h} 80% 60% / 0.55)`);
  glow(g, 260, 380, 200, `hsla(${(h + 40) % 360} 70% 50% / 0.35)`);
  g.fillStyle = "rgba(0,0,0,0.35)";
  for (let k = 0; k < 4; k++) g.fillRect(30 + k * 64, 220 - (k % 2) * 40, 26, 230);
  g.fillStyle = "rgba(255,255,255,0.92)";
  g.font = "700 30px system-ui, sans-serif";
  wrap(g, title.toUpperCase(), 24, 370, 252, 34);
  return c;
}

function still(i: number, w: number, h: number): HTMLCanvasElement {
  const [c, g] = canvas(w, h);
  const hue = HUES[(i + 3) % HUES.length];
  g.fillStyle = `hsl(${hue} 30% 12%)`;
  g.fillRect(0, 0, w, h);
  glow(g, w * 0.7, h * 0.3, w * 0.5, `hsla(${hue} 80% 60% / 0.5)`);
  glow(g, w * 0.2, h * 0.9, w * 0.4, `hsla(${(hue + 60) % 360} 60% 50% / 0.3)`);
  g.fillStyle = "rgba(0,0,0,0.4)";
  for (let k = 0; k < 7; k++) g.fillRect(w * 0.06 + k * w * 0.13, h * (0.45 - (k % 3) * 0.08), w * 0.05, h);
  return c;
}

function icon(i: number, letter: string): HTMLCanvasElement {
  const [c, g] = canvas(128, 128);
  g.fillStyle = `hsl(${HUES[i % HUES.length]} 70% 52%)`;
  g.beginPath();
  g.roundRect(8, 8, 112, 112, 30);
  g.fill();
  g.fillStyle = "#fff";
  g.font = "800 64px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(letter, 64, 68);
  return c;
}

/** A placeholder title logo: the name in a heavy face with an outline, on transparency, as Fanart.tv logos are. */
function logo(i: number, title: string): HTMLCanvasElement {
  const [c, g] = canvas(400, 155);
  g.font = `${i % 2 ? "italic 800" : "900"} 56px Georgia, serif`;
  g.textBaseline = "middle";
  g.lineWidth = 6;
  g.strokeStyle = "rgba(0,0,0,0.55)";
  g.fillStyle = `hsl(${HUES[i % HUES.length]} 90% 88%)`;
  const words = title.toUpperCase().split(" ");
  const half = Math.ceil(words.length / 2);
  [words.slice(0, half).join(" "), words.slice(half).join(" ")].filter(Boolean).forEach((l, k, all) => {
    const y = all.length === 1 ? 78 : 44 + k * 66;
    g.strokeText(l, 8, y, 384);
    g.fillText(l, 8, y, 384);
  });
  return c;
}

function wrap(g: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, lh: number) {
  let line = "";
  const lines: string[] = [];
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (g.measureText(next).width > w && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  lines.push(line);
  lines.slice(-3).forEach((l, k, all) => g.fillText(l, x, y - (all.length - 1 - k) * lh));
}

export const TITLES = [
  "The Quiet Harbour",
  "Northern Lights",
  "Glass Mountain",
  "Paper Moons",
  "A Long Way North",
  "Midnight Orchard",
  "The Last Lighthouse",
  "Saltwater",
  "Copper Sky",
  "Small Hours",
  "Over the Ridge",
  "Night Ferry",
];

let cached: Promise<Art> | null = null;

export function drawArt(): Promise<Art> {
  cached ??= (async () => {
    const [posters, backgrounds, stills, icons, logos] = await Promise.all([
      Promise.all(TITLES.map((t, i) => blob(poster(i, t)))),
      Promise.all(TITLES.slice(0, 6).map((_, i) => blob(still(i, 1280, 720)))),
      Promise.all(TITLES.map((_, i) => blob(still(i, 480, 270)))),
      Promise.all(["C", "S", "A", "M", "P", "W"].map((l, i) => blob(icon(i, l), "image/png"))),
      Promise.all(TITLES.map((t, i) => blob(logo(i, t), "image/png"))),
    ]);
    return { posters, backgrounds, stills, icons, logos };
  })();
  return cached;
}
