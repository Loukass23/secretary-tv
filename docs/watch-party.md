# Watch party

Several TVs (or later phones) play the same release at the same moment, with shared play, pause and seek, and
reactions. Nuvio Cloud has accounts but no social API, so the room service is our own: `packages/party`
(`@secretary/party`), a Cloudflare Worker with one Durable Object per room. It trusts Nuvio sessions and stores nothing
about the account beyond the room's lifetime.

Nuvio Legacy has a feature like this. As with `docs/legacy-port-plan.md`, only the idea is taken: the protocol, names,
numbers and code here are ours. Every number below is a product decision for AVPlay on the reference TV.

Status: the service and the TV client are built and tested with `node:test`; **the service is not deployed**, so a
build without `PARTY_URL` hides Watch together. "The TV client" below is the TV side; "Deploying" is what the maintainer
runs before the first party.

## Pieces

| File | Role |
|---|---|
| `src/protocol.ts` | Message types, validation, close codes, `targetPos`. |
| `src/room.ts` | The room as a pure state machine with an injected clock. All behaviour below lives here. |
| `src/do.ts` | `PartyRoom` Durable Object: sockets in, `Room` calls, messages out, snapshot to storage, one alarm. |
| `src/worker.ts` | HTTP routes, Nuvio token and profile checks, room codes, join tickets. |
| `src/auth.ts`, `src/ticket.ts` | JWT verification against Nuvio's JWKS; HMAC join tickets. |
| `src/sync.ts` | Client helpers for the TV: server clock estimate and the drift rule. |
| `src/client.ts` | The HTTP routes as the TV calls them (create, ticket, summary), and which app opens a room's content. |
| `wrangler.toml` | Bindings; `TICKET_SECRET` is a secret set before the first deploy. |

## Who may do what

Every HTTP call carries `Authorization: Bearer <Nuvio access token>`.
- The token is verified against `https://api.nuvio.tv/auth/v1/.well-known/jwks.json` (ES256 or RS256). Keys are cached
  for 10 minutes. An unknown key id refetches the set, at most once every 30 s, so rotation works and junk tokens
  cannot hammer Nuvio.
- Issuer must be `<nuvio>/auth/v1` and audience `authenticated`. Anonymous sessions are refused: the TV's QR sign-in
  starts under one, and that must not open rooms.
- The caller names a profile slot (1-6). The Worker calls `rpc/sync_pull_profiles` **with the caller's own token** and
  checks that the slot exists. A token can only speak for its own account's profiles. The profile name and colour
  become the member's display name.
- A member is `<account id>:<profile index>`, so two profiles of one account are two members. The same profile
  joining again replaces its older connection.

## Rooms

### Create

`POST /rooms` `{ profile, contentId, title, release, control, startPos? }`
- `contentId` uses the same ids as sync (`tt…`, `tt…:S:E`, `kitsu:N`).
- `release` is a fingerprint, `{ infoHash, fileIdx, size }`, **never a URL**. Each member resolves it through their
  own debrid account; the server never sees or relays a link. Only these three fields are kept, even if more are sent.
  Many sources name no file index, and none give an exact size: `fileIdx: -1` and `size: 0` mean unknown, and the file
  is then picked as for any torrent (by episode, or the largest).
- `control` is `host` (only the host commands) or `shared` (anyone does; only the host ends the room).
- The answer is `{ code, joinUrl, wsUrl, ticketExpiresAt, room }`. The creator is the host.
- Creation is limited to 5 a minute per account (a Workers rate-limit binding).

### Join

- **Code**: 6 characters from `23456789ABCDEFGHJKMNPQRSTUVWXYZ`. There is no 0/O or 1/I/L, so a code read across the
  living room is typed back right. Lower case, spaces and dashes are forgiven.
- **QR**: encodes `joinUrl` (`/j/<code>`). The page shows only the code and where to type it; nothing about the room.
- `POST /rooms/<code>/ticket` `{ profile }` answers `{ wsUrl, … , room }`, or 404 (no room) or 409 (full, 8 members).
- `GET /rooms/<code>` gives the room summary (title, state, member count) to any signed-in caller.

### Join tickets

A Tizen `WebSocket` cannot set headers, so the socket cannot carry the bearer token. Instead the ticket call returns
`wss://…/rooms/<code>/ws?ticket=…`:
- The ticket is HMAC-SHA256 over `{ room, member, exp, id }`, signed with `TICKET_SECRET`.
- It lives 60 s, opens one room, and works **once**: the room remembers used ids until they expire.
- The Worker verifies it and passes the member to the room's object. The object is reachable only through the Worker.
- A bad ticket still gets a socket, which is closed at once with `4001`. A TV cannot read the HTTP status of a refused
  handshake, but it does get the close code.
- Reconnecting means asking for a new ticket. The TV's access token renews itself, so this is cheap.

### Lifetime

- A room with nobody connected expires after 10 minutes, and any room after 12 hours (`4006`).
- `end` (host only) closes everyone with `4000`. The object then wipes its storage, so the code is free again.
- If the object restarts (a deploy, an eviction), the room comes back from storage with everyone disconnected. Clients
  reconnect with a fresh ticket and get a fresh `welcome`.

## The timeline

The room holds one timeline. Every change bumps `rev` and is broadcast as `{ t: "timeline", tl }`.

```
{ rev, state: paused | waiting | playing | ended, pos0, t0, contentId, title, release, contentRev, cause, by?, until? }
```

- `pos0` is the media position in seconds and `t0` a **server** time in ms. While `playing`, the target position at
  server time `now` is `pos0 + (now - t0) / 1000`. Before `t0` it holds at `pos0`. In every other state it is `pos0`.
- Members never stream positions to each other. Each one derives the target from `{ pos0, t0 }` and its own estimate of
  the server clock.
- `waiting` means "starting soon": the room waits for members to be positioned at `pos0`. `until` is when the wait
  gives up.
- `cause` says why the rev exists: `create`, `play`, `pause`, `seek`, `next`, `end` (commands); `stall`, `ready`,
  `timeout` (made by the server). `by` names the member whose command it was.
- `contentRev` is the rev at which the release last changed.

### Server clock

- A client sends `{ t:"ping", id, c }` every few seconds; `c` is its local send time. The server answers
  `{ t:"pong", id, c, s }`.
- Each pong gives `rtt = received - c` and `offset = s + rtt/2 - received`.
- The client keeps the last 8 samples and uses the offset of the **lowest-RTT** one. The fastest exchange is the one
  least distorted by queueing (`ServerClock` in `src/sync.ts`).
- `welcome.now` gives a rough offset until the first pong.
- The client reports its best RTT in its state messages.

### Member state

On every timeline it receives, on every change of its player's phase, and every 5 s while playing, a client sends:

```
{ t:"state", rev, phase, pos, at, rtt?, startMs? }
```

- `phase` is one of `loading`, `ready`, `paused`, `playing`, `buffering`, `ended`, `error`.
- `pos` is the player position in seconds. `at` is the server time when it was read; the server clamps it to the last
  5 s.
- `startMs` is how long this TV takes from a prepared player to the first frame. On the reference TV that is
  0.3-0.8 s; the default is 0.8 s until the client reports its own.
- A report about a rev newer than the room's is ignored.

A member is **ready** for a waiting timeline when it reported against that exact rev, its phase is `ready` or
`paused`, and its `pos` is within 1 s of `pos0`. A report about an older rev never counts. This is why a client
reports after every timeline it receives.

### Commands

`{ t:"cmd", op, base, pos?, contentId?, title?, release? }`, where `base` is the newest rev the sender had seen.

| op | from paused | from waiting | from playing |
|---|---|---|---|
| `play` | waiting at `pos0` (10 s wait) | no change | no change |
| `pause` | no change | paused at `pos0` | paused where it lands (below) |
| `seek pos` | paused at `pos` | waiting at `pos` (10 s) | waiting at `pos` (10 s) |
| `next` | waiting at `pos` or 0 with the new release (30 s wait) | same | same |
| `end` | ended; everyone closed with `4000` | same | same |

- **No-op commands** answer only the sender, with the current timeline.
- **Stale commands are rejected.** A command whose `base` is older than the last rev made by *someone else's* command
  answers `{ t:"error", code:"stale", tl }`. Two people pressing at once can therefore never undo each other in a race.
  The rejected client shows the new state; if its user still wants the change, they press again.
  - The sender's own earlier command does not make its next one stale, so pause-then-seek from one remote works
    without waiting for the echo.
  - Revs the server makes (the start after a wait, a stall) do not count either. A pause sent during "starting soon"
    still lands.
- **Permissions**: in `host` rooms a guest's command answers `forbidden`. `end` and host handover are host-only in
  both modes.
- **Pause landing**: a pause lands on the model position when the server receives it (`pos0` if before `t0`). If the
  pauser sent its own `pos` and that is within 2 s of the model, it lands there instead, so the pauser's picture does
  not jump back. Others are within tolerance of it anyway.
- **next** opens a new source for everyone. It gets the longer 30 s wait, since a cold open takes about 5 s, and
  everyone who was catching up is back in sync (see below).

### Starting together

When everyone in sync is ready, or the wait runs out, the room schedules the start `lead` ahead:

```
lead = clamp( max over waited members (rtt/2 + startMs) + 150 ms, 400 ms, 4 s )
tl   = { state: playing, pos0, t0: now + lead }
```

- `rtt/2` is how late the slowest member hears the start; `startMs` is how long its player takes once told.
- Each client calls `play()` when its server clock reaches `t0`.
- A client that receives the timeline after `t0` plays at once and is a little behind. The drift rule decides whether
  that matters.

### Buffering

- A member in sync that reports `buffering` while playing (after `t0`) gets 1.5 s of grace. Short blips are normal on
  remote 4K files.
- After that, the room switches to `waiting` at the model position at that moment (`cause: "stall"`), with a 10 s cap.
  The others pause where they are, at that position, so they need no seek.
- The staller is behind the frozen position. When its buffer recovers it plays on by itself, pauses on reaching
  `pos0`, and reports `ready`. If it is more than 10 s behind, it reopens there once instead.
- **Wait cap**: whoever is still not ready when `until` passes becomes `catching_up`, and the start goes ahead for the
  rest (`cause: "timeout"`). The same cap applies to every wait (play, seek, next).
- **Repeat stallers**: a member whose stalls froze the room more than 3 times in 5 minutes stops freezing it. Its next
  stall makes it `catching_up` instead of pausing everyone.

### Catching up alone

`status: "catching_up"` (shown in `members`) means the member plays on its own and nobody waits for it.
- While the room plays, it seeks once to the target, plays, and is back in sync when it reports `playing` within 1 s of
  the target.
- While the room is paused or waiting, it is back in sync as soon as it is ready at `pos0`.
- **Late joiners** start as `catching_up` if the room is playing or waiting. They join a paused room in sync, and the
  next start waits for them.

### Host

- The host may hand the role to another connected member: `{ t:"host", to }`.
- If the host disconnects, it stays host for 30 s, because TVs drop Wi-Fi and the app may be suspended. Coming back
  within that time keeps the role.
- After 30 s, the longest-present connected member becomes host and the old host is dropped from the list. If it comes
  back later, it joins as a guest.
- Playback is not interrupted by any of this; in a `host` room nobody can command until there is a host again.

### Reactions

- `{ t:"react", emoji }` sends one of a fixed set of names: `laugh`, `wow`, `love`, `sad`, `clap`, `fire`, `scared`,
  `eyes`.
- They are broadcast as `{ t:"react", from, emoji, s }`. Each client draws its own art for them.
- They are names rather than free text, so there is nothing to moderate and nothing to escape.

### Other server messages

- `welcome { you, room:{code, control}, tl, members, now }`: the first message on every connection.
- `members { list:[{ id, name, color, host, status, phase, connected }] }`: sent when anyone joins, leaves, changes
  status or phase, or the host changes.
- `error { code, op?, tl? }`, where `code` is one of `stale`, `forbidden`, `rate_limited`, `bad_message`, `invalid`,
  `ended` or `no_member`.

## Limits

| What | Limit | Over it |
|---|---|---|
| Members | 8 connected | ticket 409, socket `4005` |
| Any message | 40 burst, 20/s refill | closed `4008` |
| Commands | 3 burst, 1.5/s | `error rate_limited` |
| Reactions | 5 burst, 0.7/s | `error rate_limited` |
| Malformed messages | 5 per connection | closed `4011` |
| Silence | 45 s without any message | closed `4010` |
| Message size | 2 KB | malformed |
| Room creation | 5/min per account | HTTP 429 |

## Close codes

| Code | Meaning | Client should |
|---|---|---|
| 4000 | Host ended the room | Leave the party, keep playing alone |
| 4001 | Ticket bad, used or expired | Get a new ticket once, then give up |
| 4003 | Forbidden | Give up |
| 4004 | No such room (or gone) | Tell the user the code is not valid |
| 4005 | Room full | Tell the user |
| 4006 | Room expired | Leave the party |
| 4008 | Rate limited | Reconnect after a pause |
| 4009 | Same profile connected elsewhere | Do not reconnect |
| 4010 | Silent too long | Reconnect |
| 4011 | Malformed messages | Bug: do not reconnect |
| other | Network | Reconnect with backoff (1, 2, 4… up to 30 s) and a new ticket |

## Storage and cost

- The object keeps the room in memory and writes a snapshot to storage on every timeline or member change and on every
  alarm. Pings and reactions alone write nothing.
- One alarm is kept at the room's next deadline: a wait cap, stall grace, host grace, idle timeout or expiry.
- The object does not use WebSocket hibernation: members ping every few seconds, so it would never sleep anyway.

## Constraints for the TV client

These come from `docs/lessons.md` and shape the client, not the server:

- **One decoder.** A member's TV cannot prepare a second source while one plays. `next` therefore always passes through
  a wait, and the gap between episodes stays about 3 s plus the slowest member's open.
- **Seeking is a reopen.** A seek on a prepared AVPlay stream blocks the page for 3-34 s on a remote 4K file. The
  player seeks by reopening the source with an IDLE `seekTo` before `prepareAsync`, which costs seconds of preparing.
  So:
  - drift is corrected by a **single, rare** reopen: at most one every 30 s, and only when off by more than 2 s
    (`correction()` in `src/sync.ts`);
  - the reopen targets where the room will be once it is done, `target(now + reopenMs)`, where `reopenMs` is what this
    TV's last reopen took;
  - drift under 2 s is lived with;
  - **never** correct by changing the playback rate; AVPlay on this TV has no reliable smooth rate change for remote
    files, and a decoder hiccup costs more than the drift.
- **Pause and wait without seeking.** In a stall wait the others pause where they are (that is the frozen position). A
  member that is behind plays forward to `pos0` rather than seeking. Only a gap over 10 s is worth a reopen.
- **Prepare-ahead fits the lead.** On `waiting`, a member opens the release at `pos0` with the IDLE seek, prepares, then
  reports `ready`. On `playing` it calls `play()` at `t0`. From prepared to the first frame takes 0.3-0.8 s, which is
  what `startMs` reports.
- **Suspend and resume.** When the app is hidden (`suspend()`), the socket will likely drop. On `restore()` the client
  reconnects with a new ticket, reads `welcome`, and rejoins as `catching_up` if the room is playing.
- **No URLs leave the TV.** The client sends the fingerprint from the source it picked. A guest whose debrid account
  cannot resolve that `{ infoHash, fileIdx, size }` reports `phase: "error"`, is left out at the wait cap, and is shown
  "This release is not available on your account".
- **Budget.** `src/sync.ts` and `src/protocol.ts` are written to be imported by path into a Tizen app (no Workers or
  Node APIs). They add about 2 KB gzip.

## The TV client

The catalog apps join rooms; Nest only looks a code up and opens the right app.

| File | Role |
|---|---|
| `catalog-kit/src/lib/party.ts` | The connection: the first socket on the create/join answer's ticket, later ones on a fresh ticket, pings (three quick ones on every connect, then every 3 s), the close-code rules below, and the room as the overlay shows it. Also the fingerprint of a source (`releaseOf`) and the room's release as this TV's own source (`streamFor`). |
| `catalog-kit/src/lib/partyplay.ts` | The follower: the timeline applied to the player. |
| `catalog-kit/src/ui/PartyOverlay.tsx` | Over the video, smoked glass: the code chip, reactions, the notice line, and the panel. |
| `catalog-kit/src/ui/PlayerView.tsx` (`party`) | The player in a party: the room starts it, the keys send commands. |
| `catalog-kit/src/ui/Detail.tsx` (`party`) | 👥 Watch together: start a party, or join with a code (TV keyboard). |
| `catalog-kit/src/app.tsx` | One session at a time; the room's content decides what the player opens. |
| `launcher/src/party.tsx` | Nest's 👥 button: type a code, see what is on, open the app with `open.room`. |

### Starting and joining

- **Start**: on a detail page, 👥 Watch together › Start a party. Autoplay picks the source as Play would, but only
  among torrent sources, since only those have a fingerprint. The room is created paused at the resume point, as the
  signed-in profile, with host control; the host's TV opens the player on that source, prepared and paused, with the
  code on screen. OK starts it for everyone.
- **Join**: Nest › 👥 › type the code; Nest shows the room's title and member count, then launches the catalog app with
  `open: { type, title, room }` in the launch payload (`nuvio/src/handoff.ts`). The app asks for a ticket, connects,
  and opens the room's content from `welcome`: the title's meta, the episode by its id, and the release through **this
  TV's first debrid service** (`debrid:<service>:<hash>[/<fileIdx>]` with the episode hint). The detail page's
  "Join with a code" does the same without Nest.
- A room that is already playing is opened 6 s ahead of it (about what opening a remote file takes), and the drift rule
  fixes the rest with one reopen.
- The QR in the panel points at `joinUrl`. It is there for a phone; on a TV the code is what gets typed.

### The follower

- Prepared and never started is `ready`. The player's `start()` is held back until the room says play: a timeline that
  is `playing` with `t0` ahead schedules `play()` on the server clock; one received after `t0` plays at once.
- `waiting` (and `playing` before `t0`): within 1 s of `pos0` the player pauses there; up to 10 s behind it plays
  forward and pauses on reaching `pos0`; further, or ahead, it pauses and reopens at `pos0`.
- `paused`: pause; reopen only when more than 2 s from `pos0`.
- `playing` after `t0`: `correction()` from `src/sync.ts` every 250 ms, which allows one reopen per 30 s and only over
  2 s of drift, aimed at `target(now + reopenMs)`. `reopenMs` is this TV's last measured reopen (3 s until then);
  `startMs` is its last measured prepared-to-first-frame (0.8 s until then). The playback rate is never touched.
- State reports go on every timeline, every phase change and every 5 s while playing.
- A timeline for other content (`next`) is not applied by the player: the app opens that content in a new player.

### Keys in a party

- OK / Play / Pause send `play` or `pause` (a pause carries this TV's position). Left / Right add up 10 s steps and send
  one `seek` once the presses settle (400 ms). In a host room a guest's press only shows "Only the host controls
  playback".
- Up (or Blue) opens the panel: reactions (OK sends one), the members with their state (the host's OK on one hands the
  host role over), and Close / Leave / End for everyone (host). Back closes the panel.
- Back in the player leaves the party and the player. The room goes on; a host that leaves stays host for 30 s.
- The skip pill, the Up next card and the pause panel are off in a party. At the end of an episode, a TV that may
  command looks up the next episode's sources, prefers the same release as before, and sends `next`.
- When the party closes (ended, expired, refused), the notice says why and the player plays on alone with the usual
  keys.

### Size

The client adds about 12 KB gzip to each catalog app (64.7 to 76.5 KB, half of it the QR encoder) and 1.4 KB to Nest,
inside the 300 KB and 100 KB budgets.

## Deploying

Nothing here has been run against the maintainer's Cloudflare account; the maintainer runs it.

1. From `packages/party`, sign in to the maintainer's account: `pnpm dlx wrangler@4 login`.
2. Make the ticket secret, 32 random bytes, and store it (it never goes in the repo or the TV builds):
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`, then
   `pnpm dlx wrangler@4 secret put TICKET_SECRET` and paste it.
3. Check `wrangler.toml`:
   - `NUVIO_URL` is `https://api.nuvio.tv`. The JWKS the Worker verifies tokens with is derived from it:
     `https://api.nuvio.tv/auth/v1/.well-known/jwks.json` (check it answers with `curl` first), with issuer
     `https://api.nuvio.tv/auth/v1` and audience `authenticated`. No JWKS secret is needed: the keys are public.
   - `[[ratelimits]] namespace_id` must be unique among the account's rate-limit namespaces.
   - `PUBLIC_URL`: leave it out to use the `workers.dev` origin, or set the custom domain if one is routed to the
     Worker. It only shapes `joinUrl` and `wsUrl`.
4. `pnpm --filter @secretary/party check` (a dry-run bundle, about 11 KB gzip), then
   `pnpm dlx wrangler@4 deploy`. Note the origin it prints, for example `https://secretary-party.<account>.workers.dev`.
5. Smoke test with a real access token (Nest's, from `localStorage` `sectv.nuvio.session` over `cdp.mjs`):
   `curl -i https://<origin>/rooms/ABC234 -H "Authorization: Bearer <token>"` answers 404 `no such room`; without the
   header it answers 401.
6. Build the TV apps with the origin: add `PARTY_URL=https://<origin>` to the repo's `.env` (gitignored; `tizen.mjs`
   reads it), then `node ../tv-kit/scripts/tizen.mjs deploy` from `packages/launcher` and each catalog app.
7. Two-device check: start a party from a detail page on one TV, join it by code from Nest on the other, then OK,
   pause, seek, a stall (unplug the network briefly), reactions, a host handover, Back on the host, and End for
   everyone. The two sides must be **two profiles** (Frenchie, profile 3, on one side and another profile on the
   other): a member is account + profile, so the same profile joining again replaces the first connection (`4009`).
   With one TV, two catalog apps cannot both hold the decoder, so the second side has to be another TV.

## Running it

- `pnpm test` covers the room, auth, tickets, the routes against an in-memory Durable Object, and the client helpers.
- `pnpm --filter @secretary/party dev` runs it locally with `wrangler dev` (fetched on demand, not a dependency). Set
  `TICKET_SECRET` in `packages/party/.dev.vars` first.
- Before deploying: see "Deploying" above.
