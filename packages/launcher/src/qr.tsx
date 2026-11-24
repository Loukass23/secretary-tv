// A QR code drawn as SVG: the Nuvio sign-in (account.tsx) and the phone keyboard on the search screen (search.tsx).
import { useMemo } from "preact/hooks";
import { encode } from "uqr";

/** The QR as one SVG path of dark modules (crisp at any size, no canvas). */
export function QrCode({ text, size }: { text: string; size: number }) {
  const { path, n } = useMemo(() => {
    const { data } = encode(text, { ecc: "M", border: 2 });
    let d = "";
    data.forEach((row, y) => row.forEach((dark, x) => dark && (d += `M${x} ${y}h1v1h-1z`)));
    return { path: d, n: data.length };
  }, [text]);
  return (
    <svg class="nest-qr" width={size} height={size} viewBox={`0 0 ${n} ${n}`} shape-rendering="crispEdges">
      <rect width={n} height={n} fill="#fff" />
      <path d={path} fill="#101114" />
    </svg>
  );
}
