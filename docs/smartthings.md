# SmartThings

Nest controls SmartThings straight from the TV: scenes, lights, the vacuum, and home status. No server is needed for
any of it. The server's `/domotics` stays as a fallback for builds without SmartThings on Nest.

## What it does

| | Where | How |
| --- | --- | --- |
| Scenes and lights | Nest's Lights button opens the Lights panel | OK runs a scene or switches a light. Matter lights show "Local · TV hub". |
| Movie lights | Catalog apps, Settings → Lights → Movie lights | On Play the app runs the scene marked 🎬 in the Lights panel (Red on a scene); when the player closes, the scene marked ↩ (Green). |
| Home status | Nest's home screen | A toast when the phone leaves or comes home, when the vacuum starts, finishes or gets stuck. |
| Daylight | Nest, theme Automatic | Follows the TV's light sensor when the room is clearly bright (150 lux or more) or dark (under 60 lux), and the clock in between. |
| By name | Ask Nest, typed or spoken | "turn off the couch light", "couch light to 30%", "dim the lights to 20%", "lights off", "run energetic lights", "start the vacuum", "send the robot home". It is matched on the TV against your device and scene names; anything else goes to the assistant as before. |

## Set it up (once)

1. **A personal access token.** Create one at account.smartthings.com/tokens with every scope, and put it in `.env` as
   `SMARTTHINGS_TOKEN`. On its own it already works for about 24 hours: Nest uses it when no OAuth app is set up,
   which is handy for a first try.
2. **The OAuth app.** Personal tokens made since 2025 expire after a day, so Nest uses an API Access app with refresh
   tokens:

   ```bash
   node packages/tv-kit/scripts/smartthings.mjs create-app
   ```

   Put the printed `SMARTTHINGS_CLIENT_ID` and `SMARTTHINGS_CLIENT_SECRET` in `.env.tizen`, then redeploy Nest. If
   SmartThings refuses because the token lacks the apps scope, the script prints the CLI route instead
   (`npx @smartthings/cli apps:create`, "OAuth-In App").
3. **Sign in.** With Nest running and `tizen.mjs debug` giving the inspector port:

   ```bash
   node packages/tv-kit/scripts/smartthings.mjs authorize <port>
   ```

   The browser opens SmartThings' consent page. After you allow it, SmartThings lands on this repository's GitHub page
   with `?code=…&state=…` in the address. Paste that whole address into the terminal; the script swaps the code for
   tokens and stores them in Nest. (`SMARTTHINGS_REDIRECT_URI` picks another landing page; it has to load, since a
   404 page made the sign-in fail.)

From then on Nest refreshes the tokens itself. Run `authorize` again when Nest says "SmartThings needs signing in
again": a refresh token unused for 29 days expires, and reinstalling Nest wipes it.

## How it works

- **`packages/smartthings`** is a `fetch`-only client shared by Nest and the catalog apps:
  - `devices()` returns every device with its status in one call (`GET /devices?includeStatus=true`);
  - `command()`, `scenes()`, `runScene()`, `rooms()`;
  - OAuth: `authorizeUrl`, `exchangeCode`, and `oauthTokens`, a refreshing token source;
  - pure helpers: `homeAlerts` (what changed between two polls), `homeAction` (prompts that name a device or scene),
    and `roomLux`.
- **Only Nest holds the refresh token** (`localStorage["nest.smartthings"]`).
  - A refresh token works once, and every refresh is saved before its access token is used. Refreshes run one at a
    time and start an hour before expiry.
  - The catalog apps are separate packages with their own storage. If they refreshed too, they would cancel Nest's
    token. Instead Nest puts its current access token (good for up to 24 h) and the two scenes in the launch payload
    it already sends (`home` in `packages/nuvio/src/handoff.ts`).
  - A catalog app opened some other way, or after the token expired, falls back to the server's 15 % cinema preset.
- **No CORS on the TV.** Tizen packaged apps apply no CORS (`docs/lessons.md`), so Nest calls `api.smartthings.com`
  directly.
- **Polling.** Nest asks for device status every 15 s while its home screen or the Lights panel is up, and not while
  hidden. The device list allows 10 calls per ~15 s per token; scenes allow 100.

## What the docs and the reference home showed (2026-10-31)

- **The "cloud-connected devices" guide is the other direction.** SmartThings Schema brings a vendor's cloud devices
  into SmartThings, and needs its own OAuth server and hosted app. Secretary TV is a client of the public REST API
  instead.
- **The TV is the hub.** The account's only hub is the TV itself ("Hub - 43" Crystal UHD"). Its two Matter lights run
  on it (`executionContext: LOCAL`); the TP-Link, Yeelight and Tuya lights are cloud-to-cloud.
  - Tizen web apps get no local hub API, so commands for local devices also go through the cloud, which hands them to
    the TV's hub.
- **The TV doesn't report our playback.** It exposes `mediaPlayback`, but `playbackStatus` was `null`, so a
  SmartThings Rule on the TV can't follow playback in our apps. Movie lights run from the catalog apps instead.
- **The TV's light sensor** reports `illuminanceMeasurement`: 35 lux at night with a few lamps on.
- **The only camera** is the POWERbot vacuum's (`imageCapture`), so there are no snapshot alerts.
- **No push without a server.** Device events reach only a SmartApp webhook on a public server, which is why Nest
  polls.
- **Sign-in.**
  - API Access apps use the authorization-code flow with a client secret; there is no PKCE or device-code flow.
  - Access tokens last 24 h; a refresh token expires after 29 days unused.
  - SmartThings staff advise against `localhost` redirect URIs. A redirect to a page that didn't exist yet (404)
    failed after sign-in, so the redirect is the repository's front page.

## What the sign-in really needed (2026-10-31)

None of this is in SmartThings' docs. It took these fixes before the reference account got a code:

- **The consent page is `https://api.smartthings.com/oauth/authorize`, without `/v1`.** The `/v1` path the docs give
  answered "Resource representation is only available with these types: text/html" once signed in.
- **PKCE.** The consent page adds `code_challenge_method=S256` itself, and fails without a `code_challenge`. Sending
  the method too was refused (`invalid_code_challenge_method_provided`). So the script sends only `code_challenge`,
  then `code_verifier` with the code. The refresh needs no verifier.
- **Changing a redirect URI doesn't take.** `PUT /apps/{id}/oauth` saved the new address, but the sign-in kept
  answering "'redirect_uri' could not be validated". A new app created with the right address worked. Delete the
  first one if it is left over.
- **The redirect page has to load.** The one that worked is the repository's front page, which keeps `?code=` in the
  address.
- **On Windows, `cmd /c start` cuts the link at its first `&`,** and the terminal cut it at the first `+` when
  clicked. The script opens the link with `rundll32 url.dll,FileProtocolHandler` instead.
- **The token is location-level.** The account chooses one location on the consent page, and the API then shows
  that location's devices (14 of 15 here).
- **Redeploying Nest reinstalls it and wipes its storage, sign-in included.** Copy `localStorage["nest.smartthings"]`
  off the TV before a deploy and back after it (through the inspector), or run `authorize` again.

## Not done

- **The server still uses `SMARTTHINGS_TOKEN` directly.** It is a personal token, so it stops working within a day.
  Giving the server its own OAuth sign-in (a second refresh chain) is the next step if Desk's light buttons are
  wanted without Nest.
- **Levels in the Lights panel:** set them by voice for now.
- **Pausing a film** doesn't change the lights.
