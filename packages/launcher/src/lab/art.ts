// Art for the glass lab: the Nest backdrop plus two placeholder tiles, drawn at boot so the lab
// needs no assets or network.
import { blob, canvas, drawBackdrop, glow } from "@secretary/tv-kit/src/glass/index.ts";

export interface LabArt {
  wallpaper: string;
  blurred: string;
  tiles: [string, string];
}

function drawTile(seed: number): HTMLCanvasElement {
  const [c, g] = canvas(480, 280);
  g.fillStyle = seed ? "#2a2320" : "#1d2026";
  g.fillRect(0, 0, 480, 280);
  glow(g, seed ? 340 : 140, 90, 260, seed ? "rgba(255,150,90,0.5)" : "rgba(150,170,220,0.45)");
  g.fillStyle = "rgba(0,0,0,0.55)";
  for (let i = 0; i < 5; i++) g.fillRect(40 + i * 92 + seed * 20, 120 - (i % 3) * 30, 34, 200);
  const shade = g.createLinearGradient(0, 140, 0, 280);
  shade.addColorStop(0, "rgba(0,0,0,0)");
  shade.addColorStop(1, "rgba(0,0,0,0.75)");
  g.fillStyle = shade;
  g.fillRect(0, 0, 480, 280);
  return c;
}

export async function drawArt(): Promise<LabArt> {
  const [{ wallpaper, frost }, a, b] = await Promise.all([drawBackdrop(), blob(drawTile(0)), blob(drawTile(1))]);
  return { wallpaper, blurred: frost, tiles: [a, b] };
}
