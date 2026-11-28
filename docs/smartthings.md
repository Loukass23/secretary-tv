# SmartThings

Nest controls SmartThings straight from the TV: scenes, lights, the vacuum, and home status. No server is needed for
any of it. The server's `/domotics` stays as a fallback for builds without SmartThings on Nest.

## What it does

| | Where | How |
| --- | --- | --- |
| Moods | OK on the header's lights button opens the mood strip under it (`mood-strip.tsx`); its last icon ("more") opens the Mood panel (`mood.tsx`) | Cinema (lights dim, side lights follow the poster), Music (warm room, the dance on), Dining (warm and brighter, side lights still) and Off, then the routines chosen to show, each with its icon. One press on an icon in the strip sets that mood; Up, Down or Back close the strip. Each mood is built from the commands below, the light effects, and optionally the TV's picture mode and the sound system (`moods.ts`); the panel's preview says what it will do and the active one is marked. The header's lights button shows the active mood's icon (the plain bulb before any). The Home card's four buttons, and Ask's "cinema mode", "music mode", "movie night" (Cinema) and "goodnight" (Off), set the same moods as the viewer set them (`assistant` `Effects.mood`); "good morning" has no mood and brings the warm lights up. |
| Mood editor | Settings › SmartThings, after the light effects | One mood at a time: the first line picks the mood (Left and Right), then a line each for its lights (cinema, music, warm, off, any routine, or "as they are"), each light effect (on, off, or "as it is"), the picture mode ("as it is", the two favourites, then the modes the TV lists) and, with a sound system, the sound system (on, off, as it is). Left and Right step a line, OK steps forward; the preview rewrites what the mood does. Changes are saved as `nest.moods` (`{ [mood key]: { lights?, fx?, picture?, sound? } }`, `null` for "as it is") over the defaults in `moods.ts`, which `applyMood()` (app.tsx) follows; a changed mood gets a last line that puts it back. A routine's mood takes changes by its key (`routine:<id>`). This TV's sound mode is not open to apps (`webapis.settings` has only the sound output), so the sound part is the sound system on or off. |
| Routines and lights | Settings › SmartThings (`smartthings-settings.tsx`, a category Secretary adds to Settings) | The light effects and their switches, then the routines (SmartThings scenes, manual routines in the app): OK shows or hides one in Mood, Left and Right give it its part with a film (on Play, after the film); then every light and switch by room (rooms by name; devices in no room under "No room"), OK switches it. Each line has a preview. |
| Movie lights | Catalog settings, Settings → Lights → Movie lights | On Play Secretary runs the routine set to "Runs on Play" in Settings › SmartThings; when the player closes, the one set to "Runs after the film". |
| Home status | Nest's home screen | A toast when the phone leaves or comes home, when the vacuum starts, finishes or gets stuck. |
| Daylight | Nest, theme Automatic | Follows the TV's light sensor when the room is clearly bright (150 lux or more) or dark (under 60 lux), and the clock in between. |
| By name | Ask Nest, typed or spoken | "turn off the couch light", "couch light to 30%", "dim the lights to 20%", "lights off", "run energetic lights", "start the vacuum", "send the robot home", "eco mode", "picture mode dynamic". It is matched on the TV against your device and scene names; anything else goes to the assistant as before. |
| Cinema mode | Ask Nest "cinema mode", the Home card, the top-bar Lights button | Dims one light (the top side light, 15%) and switches every other shared light off in one step. The sound system is not a light and stays as it is. `nest.cinemaShow` (`{ keep, level }`, a name fragment and a level) changes the light that stays. |
| Music mode | Ask Nest "music mode", the Home card, the Lights button | Switches the sound system on, then brings the side lights and the couch light up to 50% one after the other (about 0.2 s apart) and switches the kitchen light off. "Stop the music" switches the sound system off. `nest.musicMode` (`{ lights, off, level }`) changes the lights. Through Secretary Server it is the warm scene. |
| Ripple | When Nest opens or comes back after 20 s or more away, and before Nest opens another app | A soft wave down the side lamp (Low, Mid, Top) that turns the lights on even when they are off: a faint cool tint, then a warm white (2700 K), then every light goes back exactly as it was (on or off, level, and its white temperature or colour; a light reporting over 75% saturation is taken to be showing a colour, as a 2700 K white itself reports about 66). Brightness follows the room: 15% in a dark room up to 75% in a bright one, from the TV's light sensor (28% at 42 lux, 50% at 150), a middle 35% without a reading; a light already on never dims for the wave. The slow one at open takes about 4 seconds in the background; the quick one before another app (about 2 s, measured on the reference home) finishes first, then the app opens, and never holds it up for more than 3 s. Steps go out on schedule and each light's commands stay in order, so the SmartThings round trip does not stretch the wave. A second ripple during the first restores to the first one's starting state, and a lights command in between (cinema, off) takes over. `nest.openRipple` set to `off` turns both off; as JSON it takes `{ lights }`. |
| Light effects | Settings › SmartThings, first lines (OK flips each) | Five switches, stored as `nest.lightFx`. **Light effects** is the master: off, nothing below runs, the ripples included (the old `nest.openRipple` still turns the ripples off too). **Splash & goodbye**: the secretary bird splash at start, and a warm swell (2700 K) played with it instead of the open ripple, which fades in four steps to a dim orange-yellow glow that stays on (a slow splash of about 5 s); off shows the plain crest. When Nest is left (Back twice) the glow fades out in three steps and the side lights go off, before the app exits (never waiting more than 4 s). When something starts playing from Nest (a title with play, not browsing), the side lights ease down to the cinema level first, keeping their colour and never raising a light, instead of the launch ripple. **Music dance**: Music mode, once the room is warm, chases colours along the side lights and the couch light (a new colour on the next light every 1.4 s, the one before easing back) for about twenty minutes, until another lights command replaces it. **Poster colour**: the metallic background takes the focused poster's colour once focus rests on it (a 32x18 sample, hue buckets weighted by chroma, skin tones discounted, grey and black-and-white art ignored, then held in OKLCh ranges so a loud poster gives a calm background). **Side lights match** (off until chosen): the side lights take the same colour, sent as hue and saturation (at least 45 so it reads as colour) at the room-following brightness, at most one change every 4 s and only for a hue shift of 5 or more; when focus leaves the posters for 3 s, or the switch goes off, they go back as they were. The catalog has its own "Poster colour" switch in Settings, Lights, for its own pages. |
| Ripple tests | Ask Nest, or this PC | Say or type "ripple test" (the slow one) or "launch ripple" (the quick one) to Ask Nest to play it on request, even with the ripples switched off. From this PC, with the same code and a personal token in `.env`: `pnpm lights status` (the lights, the sensor, the brightness the ripple would use), `pnpm lights levels` (the brightness for a range of room light), and `pnpm lights ripple open|launch [--dry] [--lux N]`, which prints the steps, plays them (`--dry` only prints; `--lux` pretends the sensor reads N), then reads the lights again and says whether each is back as it was. |
| Sound button | Nest's top bar, between Picture and the bell | OK switches the sound system on or off. The icon is a hi-fi speaker with sound arcs when it is on and a slash when it is off, and flips at once while SmartThings confirms. |
| Independent lights | Every mode, scene and "all the lights" prompt | The computer desk is never switched by a mode; naming it still works ("turn off the computer desk"). `nest.independentLights` (name fragments) changes the list. |
| Picture mode | Secretary: Red on the remote, the Picture button in the top bar, a mood that sets one, or Ask ("eco mode") | Flips the TV between two favourite picture modes (Dynamic and Eco by default, `nest.pictureModes` in local storage to change them). It reads and sets the mode on the TV itself (`picture-mode.ts`), and falls back to SmartThings where the TV has no such API. The first press always switches to the other mode of the pair, even after the remote changed it. The button's icon is a sun on Dynamic, a moon on Eco. |

**On the TV itself (checked 2026-11-27 on the reference 43" Crystal UHD, firmware 3.5.1).** Samsung's
`webapis.settings` answers for the item `picturemode` (the first child of `picture`) with what the TV's own menu shows,
`{ osdName: "Dynamic", value: 65536 }`, with no extra privilege in `config.xml`. It follows a change made outside
Secretary within two seconds (checked by running the "TV Eco" and "TV Dynamic" scenes, which change the mode as the
remote and the SmartThings app do). `getItemDataList("picturemode")` lists every mode, each name several times, once per
kind of source (the high 16 bits of the value: 65536 is the TV's own apps, where Secretary runs), and
`setItemValue("picturemode", String(value))` sets one and returns `true`; reading again then gives the new mode.
`picture-mode.ts` sets the entry of the current source's kind. Each call is synchronous and costs about 16 ms on this
TV, so Secretary reads it on load, when it comes back to the screen (`visibilitychange`) or gets the window back
(`focus`, after the TV's own menu), every 30 s with the clock, after each change and at each press, never per frame.
Other probes: `webapis.avinfo.getBacklight` and `getBrightness` answer "Permission denied" (partner privilege);
`webapis.tvinfo` and `tizen.tvdisplaycontrol` have nothing on the picture mode; `getItemDataList` with an item id that
does not exist once crashed the app, so only `picturemode` is ever read.

Tested inside Secretary on 2026-11-27: Secretary last set Dynamic, then the "TV Eco" scene moved the TV to Eco from
outside; one Red press switched it to Dynamic (before, the toggle went by `nest.pictureLast`, asked for Eco and nothing
changed until a second press). The other way round (last set Eco, the TV moved to Dynamic outside) one press gave Eco.

**Without that API (another TV), make two scenes in the SmartThings app**, named for the TV and the mode: "TV Eco" and
"TV Dynamic" (manual routines whose one action sets the TV's picture mode). Secretary runs the scene named for the mode
(`pictureScene`). Why scenes (tested 2026-11-20 on the reference TV): the TV reports `samsungvd.pictureMode` (modes
Dynamic, Eco, FILMMAKER MODE, Movie, Standard; command `setPictureMode(mode)`), and the cloud API accepts that command
with `COMPLETED`, but the TV answers "this function is not available" and the picture does not change, by name or by
internal id. The SmartThings app and a scene running the same mode do change it. Without the scenes Secretary still
sends the command, which another TV may take directly.

**SmartThings' status is stale.** The attribute's value and timestamp never move on this TV: on 2026-11-27 it still read
Dynamic at 2026-11-20T11:13 after the mode had been changed several times, by scenes too. So without the TV's own
reading Secretary keeps the mode it last set and when (`nest.pictureLast`, `{ mode, at }`; older builds stored the bare
name) and trusts whichever is newer, SmartThings' report by its timestamp or its own last set (`currentPicture`). On a
TV whose attribute does update, a change by the remote then wins over Secretary's older one.

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

- **`packages/smartthings`** is a `fetch`-only client used by Secretary, its home screen and its catalog:
  - `devices()` returns every device with its status in one call (`GET /devices?includeStatus=true`);
  - `command()`, `scenes()` (with the last run), `runScene()`, `rooms()` and `roomsIn()` (every room of the homes
    given), with every page of a list read (`_links.next`, at most 20 pages);
  - `groupByRoom` (`rooms.ts`): devices grouped by room for the Lights panel;
  - OAuth: `authorizeUrl`, `exchangeCode`, and `oauthTokens`, a refreshing token source;
  - pure helpers: `homeAlerts` (what changed between two polls), `homeAction` (prompts that name a device or scene),
    and `roomLux`.
- **The side lights follow the screen** (`packages/smartthings/src/lights-controller.ts`, one controller for Nest and the
  catalog; Lights panel switches apply):
  - Browsing: with *sync* on, the side lights take the accent of the poster in focus, in Nest and in Cinema, Shows and
    Anime (the apps read `home.lights` in the launch payload). Nothing changes while sync is off, and nothing is sent
    when the TV's light sensor reads 150 lux or more, where the colour could not be seen.
  - Playback: the side lights fade off when it starts, come back softly (the cinema level) while it is paused, go off
    again on resume, and return to how they were when the player closes. Without the payload the movie scene or the
    server's cinema preset dims as before.
  - Opening: the splash leaves a dim glow; when the sensor (read before the wave) says 150 lux or more (`BRIGHT_LUX`, the
    line Daylight uses), the glow fades out instead of staying.
  - How it feels is set in `.env.tizen`: `NEST_MOOD_STEP_MS` (default 500) is the time between the three moves of a
    colour change, `NEST_MOOD_SETTLE_MS` (default 700) how long focus rests before the lights start.
- **Only Nest holds the refresh token** (`localStorage["nest.smartthings"]`).
  - A refresh token works once, and every refresh is saved before its access token is used. Refreshes run one at a
    time and start an hour before expiry.
  - (History: the catalog apps were separate packages with their own storage.) If they refreshed too, they would cancel Nest's
    token. Instead Nest puts its current access token (good for up to 24 h) and the two scenes in the launch payload
    it already sends (`home` in `packages/nuvio/src/handoff.ts`).
  - The catalog, after the token expired, falls back to the server's 15 % cinema preset.
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
  SmartThings Rule on the TV can't follow playback in our app. Movie lights run from Secretary's catalog instead.
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

**Shimmer and easing.** The Lights panel's "Shimmer" switch (Nest) slides three soft metallic bands over the
background (`tv-kit/src/glass/sheen.tsx`: transform-only layers, paused while keys are pressed), tinted with the
poster's accent pulled toward savanna gold. "Poster colour" (and, in the catalog, the setting of the same name) gates it
there. The background crossfades over 2.6 s, and the side lights reach a very different poster colour by way of the
halfway colour (`moodMidpoint`, 0.9 s) instead of snapping; the least gap between colour changes is 2.5 s. The cost of
the sliding bands on the TV is not measured yet: run `cdp.mjs walk` with Shimmer on and off and record it in `docs/performance.md`.
