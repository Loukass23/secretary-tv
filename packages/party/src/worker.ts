// The Worker's entry. Workers treats every export of this module as a handler or a Durable Object class, so it
// exports only those; the logic and its helpers live in service.ts (docs/watch-party.md has the routes).
import { createHandler, type Env } from "./service.ts";

export { PartyRoom } from "./do.ts";
export { PasteBox } from "./paste.ts";

const handler = createHandler({ fetch: (input, init) => fetch(input, init), now: () => Date.now() });

export default {
  fetch: (req: Request, env: Env) => handler(req, env),
};
