# Watching together: Secretary and Nuvio

Investigation only (2026-11-24, screen 13 of the screen review). No product code changed. It answers three questions:
what Secretary does today, what Nuvio now offers, and what to do about it.

## 1. What Secretary does today

Full detail is in `docs/watch-party.md`; the short version:

- **Service**: `packages/party`, our own Cloudflare Worker with one Durable Object per room. **It is built and tested
  but not deployed**, so a build without `PARTY_URL` hides Watch together. That is why screen 13 shows nothing usable.
- **Auth**: the caller's Nuvio access token, verified against Nuvio's public JWKS (anonymous sessions refused). The
  Worker pulls the caller's profiles with the caller's own token to prove the profile slot is theirs. A member is
  `account:profile`. Nuvio is used only as an identity provider; there is no Nuvio party API in play.
- **Join**: 6-character code (no 0/O/1/I/L) or QR to `/j/<code>`. A one-use, 60 s HMAC ticket goes on the WebSocket
  URL, because a Tizen `WebSocket` cannot set headers. 8 members at most.
- **What is synced**: one server-owned timeline `{rev, state, pos0, t0, contentId, release}`. Members derive the target
  position from the server clock (ping/pong, lowest-RTT offset). Commands are play, pause, seek, next (next episode),
  end. Stale commands are rejected by rev. Starts are scheduled `lead` ms ahead so every TV calls `play()` together.
  Stalls freeze the room briefly; repeat stallers are made to catch up alone. Eight fixed reactions. **No chat.**
- **What is shared**: a release fingerprint `{infoHash, fileIdx, size}`, never a URL. Each TV resolves it through its own
  debrid account, so nothing about a link leaves a TV.
- **TV side**: `catalog-kit/src/lib/party.ts` (connection), `partyplay.ts` (the follower), `ui/PartyOverlay.tsx`
  (code chip, reactions, panel), `launcher/src/party.tsx` (Secretary's 👥 code entry, hands the code to the catalog
  as `open.room` via `nuvio/src/handoff.ts`). It is built around AVPlay limits: a seek is a reopen (3-34 s), so drift
  is corrected by at most one reopen per 30 s over 2 s, and the playback rate is never touched.
- **`packages/nuvio`** has no party code. It supplies the session, profiles and QR sign-in only.

## 2. What Nuvio now offers

Sources: the maintainers' own repositories (`NuvioMedia/NuvioMobile`, `NuvioTV`, `NuvioTVSmart`, `NuvioDesktop`) and
a maintainer comment on NuvioMobile issue 1156. I read the client code; I did not see the server. Nuvio's public docs
(nuvio.tv/docs v1.3, as summarised in `docs/nuvio-cloud.md`) list no party endpoints, so this is **undocumented**.

### Status and clients

- Shipped as **experimental**: NuvioMobile PR 2253 ("add experimental watch parties", merged; first in 0.6.0-beta,
  stable in 1.0.0, 2026-11-15). Releases since: 1.0.1 (11-21), 1.1.0-beta.3 (11-24).
- The maintainer says it was tested on iOS, Android and TV. Client code exists in Mobile (Kotlin Multiplatform, also
  iOS), Android TV, Desktop (alpha) and **NuvioTVSmart, the Tizen/webOS web client** (`js/core/party/*`,
  `js/core/network/realtimeClient.js`). The Tizen client is the closest existing reference to Secretary.
- The UI only appears while the server reports the feature available (`rpc/watch_party_enabled` returns a boolean), so
  Nuvio can switch it off remotely.
- Licence of the client repos: **GPL-3.0**. Secretary is MIT, so none of their code can be copied or ported
  line-for-line. The wire format (field names, RPC names) can be implemented independently, as `watch-party.md`
  already does for the older idea.

### How it works (reverse-read from the clients)

- **Backend**: the same Supabase-compatible Nuvio Cloud we already call. Control calls are RPCs under
  `rest/v1/rpc/`, with the `apikey` header and the user's bearer token (the same session `packages/nuvio` holds):
  `watch_party_create`, `_join`, `_preview` (code to media, host, member count), `_heartbeat`, `_update`, `_leave`,
  `_end`, `_set_host_only`, `_remove_member`, `_clock` (server time in ms), `_enabled`. Create and join take a device
  id, display name, avatar and optional `p_profile_index`. Chat history and send are further RPCs.
- **Live channel**: Supabase Realtime (Phoenix protocol) on a private channel `watch-party:<partyId>`, reached through
  `wss://<backend>/realtime/v1/websocket?nuvio_realtime=1&apikey=…&vsn=1.0.0` (a Nuvio-specific proxy). Events:
  `state`, `state_request`, `status`, `control`, `member_joined`, `member_left`, `ended`, `media`, `stream`, `chat`.
  Presence carries each member's status (browsing, loading, buffering, ready, behind). The bearer token travels in the
  channel join, not in a header, so a Tizen WebSocket can do it (their own Tizen client does).
- **Sessions**: created by a signed-in user from the player; others join with a **6-character code**, an invite link
  (deep link) or Settings > Watch party. Sign-in is required (the TV client's error list has "SignInRequired").
- **Sync model** (client-driven, no server timeline): playback is `{seq, member_id, paused, position_ms, rate, at,
  media_key, waiting}`, broadcast on every change. Receivers compute `position + (now - at) * rate` using a server clock
  sampled from `watch_party_clock` (lowest-RTT anchor, like ours). Correction: seek over 1.5 s, else **nudge the playback
  rate by 5 %** over 250 ms drift. Highest `seq` wins (ties by member id). A loading or buffering member makes the
  coordinator (the host, else the first online member) publish a `waiting` state, then resume.
- **Synced**: play, pause, seek, rate, **chat** (history plus live), who is loading or behind, the **media** (title,
  episode, so `next` follows), and the source choice. Members: default cap **3** (`max_members` comes from the server).
  The host can set **host-only control**, remove members, and **share their stream**: the host's resolved stream
  (URL, request headers, filename, size) is broadcast over the `stream` event so guests without a matching source can
  play it. Otherwise each guest matches the host's source (info hash plus file index, else filename, else label) among
  their own results.
- **Unknowns**: server limits, retention, rate limits, row-level rules, and whether a third-party client is allowed.
  There is no published API contract or versioning. The feature is flagged experimental and server-gated.

## 3. Comparison

| | Secretary party (ours) | Nuvio watch party |
|---|---|---|
| Status | Built, tested, **not deployed** | Live, experimental, server-gated |
| Infra | A Cloudflare Worker the maintainer must run | None for us: Nuvio hosts it |
| Auth | Nuvio JWT checked by our Worker | Nuvio session (same token), checked by Nuvio |
| Join | Code, QR, ticket | Code, link, Settings |
| Sync authority | Server timeline, scheduled starts, stale rejection | Peers broadcast `seq` states, coordinator picks waiting |
| Drift fix | One rare reopen, **never the rate** | Rate nudge plus seeks over 1.5 s |
| Start together | `t0` lead from measured RTT and start time | Wait for ready presence, then publish |
| Source sharing | Fingerprint only, no URL | Fingerprint match, or host shares a **URL with headers** |
| Chat | No | Yes |
| Reactions | 8 named | None seen |
| Members | 8 | 3 by default (server decides) |
| Cross-app | Secretary only | Nuvio on phone, desktop, Android TV, Tizen/webOS |
| Contract | Ours, documented, tested | Undocumented, can change, can be switched off |
| Licence | MIT | Clients GPL-3.0 (protocol reimplementation only) |

Things that matter most:

1. **The AVPlay constraint is the real problem.** Nuvio's model assumes a cheap seek and a rate nudge. We have neither
   (seek is a 3-34 s reopen, no reliable rate change). As a follower we can still obey their `state` and apply our
   own drift rule, but we will be several seconds off after any seek, and their coordinator's `waiting`/ready logic may
   hold the others while our reopen runs. Our own protocol was designed around exactly this.
2. **Reach.** The only reason to prefer Nuvio's is that a viewer on a Nuvio phone, desktop or another TV app could sit
   in the same room as a Secretary TV, and that it needs no deployment from us.
3. **Privacy line.** Their stream-sharing sends resolved URLs and headers through the party. Secretary must never do
   that (our rule). We would only send and honour the fingerprint fields and treat `stream` events as ignored.
4. **Dependency risk.** Reverse-engineered RPCs and a proxy URL on a service that calls the feature experimental.
   Fail-soft like our other undocumented calls, but a breaking change would be silent until a user hits it.

## 4. Options

### A. Keep ours (recommended first step)

Deploy `packages/party` as `watch-party.md` describes, and show Watch together. Effort: about half a day for the
maintainer (Cloudflare login, `TICKET_SECRET`, deploy, set `PARTY_URL`, the two-device, two-profile check). Gains the
behaviour tuned for AVPlay. Cost: a Cloudflare account to keep, no cross-app parties, no chat.

### B. Interoperate with Nuvio's parties (optional, spike first)

Add a second backend in `catalog-kit/src/lib/party.ts` behind the same overlay: create, join (code), preview and
heartbeat over RPC; realtime over a small Phoenix client (about 150 lines; Nuvio's Tizen client is the reference but
GPL, so write ours from the wire facts above, not from their code). Rules: fingerprint only; ignore the `stream` event;
follower applies our drift rule; host publishes `{seq, paused, position_ms, rate: 1, at}`.
Effort: a 2-3 day spike (create/join/play-pause between a Secretary TV and a Nuvio phone), then about a week to
harden (reconnect, suspend/restore, chat panel, errors, tests with a recorded-frame fake). Risk: protocol drift,
sync quality on seek-heavy parties, a 3-member default.
Value: parties with the real Nuvio apps and no server for us to run for those parties.

### C. Replace ours with Nuvio's

Drop `packages/party`, keep one backend. Effort: B's work plus removing ours, and rewriting `watch-party.md`. Cheapest to
operate, but we then depend wholly on an undocumented, server-gated feature, lose scheduled starts, the 8-member
room and the AVPlay-aware timeline, and inherit their rate-nudge assumptions. **Not recommended** while the feature is
experimental.

## 5. Recommendation

1. **A now**: deploy our service so screen 13 has a working feature.
2. **B as a time-boxed spike** if cross-app parties matter to the user. Decide from the spike whether it earns
   a place, as an "Join a Nuvio party" path rather than a replacement.
3. **Not C.** Revisit when Nuvio publishes a documented party API and the feature leaves experimental.

Open questions for the user: do they want parties with people on Nuvio's phone apps (that is what justifies B), and
are they willing to have Secretary call undocumented party RPCs on Nuvio's cloud? Also worth asking Nuvio's maintainers
whether third-party clients may use the party RPCs and the realtime proxy.
