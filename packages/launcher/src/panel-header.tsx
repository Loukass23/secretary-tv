// Secretary's one header (tv-kit Header) over a panel that is not the home screen (Lights, Watch together): the same
// person, buttons and clock as on the home, with the panel's own button marked. Up from the top of the panel goes into
// it; Left and Right move along it, OK acts (Secretary does), Down and Back give the panel the remote again.
import { Header, type HeaderAt, type HeaderButton, type HeaderPerson, stepHeader } from "@secretary/tv-kit/src/glass/index.ts";
import { useState } from "preact/hooks";
import { HEADER_ORDER } from "./home.tsx";
import { HEADER_PROFILE } from "./nest-nav.ts";

/** What Secretary lends a panel to draw its header. */
export interface PanelHeader {
  time: string;
  person: HeaderPerson;
  /** home.tsx headerButtons, in their order. */
  buttons: readonly HeaderButton[];
  /** OK on an item other than the panel's own, as nest-nav numbers them (HEADER_PROFILE, HEADER_SEARCH...). */
  press(i: number): void;
}

/**
 * The header's focus for a panel whose own button is `own` (a nest-nav number). `key` takes every key while the
 * header has the remote and says whether it did; `enter` is for Up at the top of the panel.
 */
export function usePanelHeader(header: PanelHeader, own: number) {
  const [head, setHead] = useState<HeaderAt | null>(null);
  const ownAt = HEADER_ORDER.indexOf(own);
  const n = header.buttons.length;
  const enter = () => setHead(ownAt >= 0 ? ownAt : 0);
  const key = (k: string): boolean => {
    if (head == null) return false;
    if (k === "Enter") {
      // The panel's own button: back into the panel.
      if (head === ownAt) setHead(null);
      else header.press(head === "person" ? HEADER_PROFILE : HEADER_ORDER[head]);
      return true;
    }
    const r = stepHeader(head, k, true, n);
    if (r === "leave") setHead(null);
    else setHead(r);
    return true;
  };
  const view = (
    <Header
      time={header.time}
      person={header.person}
      buttons={header.buttons.map((b, k) => (k === ownAt ? { ...b, badge: true } : b))}
      focus={head}
    />
  );
  return { head, enter, key, view };
}
