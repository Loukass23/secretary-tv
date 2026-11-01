# Secretary Nest & the In-App Hub

`packages/launcher` (**Secretary Nest**) is a small home-screen app in the glass style (below): a clock, a strip of installed
apps that it opens through `tizen.application`, reminders and a briefing from `@secretary/server`, cross-app Continue
Watching, a lights scene button, and **Raptor Hunt** unified search. It is a normal app on the TV. It does not
replace Smart Hub and does not change any TV setting.

Nest is the one dashboard. Every catalog app (`app-movies`, `app-series`, `app-anime`) has the same glass top bar
(`Nest | Cinema | Shows | Anime`, Search, Settings): **Nest** and CH+ open Secretary Nest (the catalog app stays alive
behind it, so coming back is instant), and the in-app Hub (`HubOverlay.tsx`) keeps only Search and Settings. Opening
Nest needs the launcher's id at build time (`SECRETARY_TV_LAUNCHER_ID`); without it the catalog app says so.

## Why not Samsung Smart Hub Preview or Samsung Universal Search?

Samsung's native Smart Hub offers two integration points—Smart Hub Preview (tiles above the app icon on the TV's home
bar) and Universal/Bixby Search—that were evaluated and rejected in favor of our own overlay architecture:

1. **Partner & Cloud Lock-In**:
   - **Samsung Universal Search** cannot be queried or populated by a local developer-signed `.wgt` app. Samsung requires
     partner-level Seller Office onboarding and cloud-to-cloud catalog feed ingestion before native TV search will index
     or deep-link into an app.
   - **Smart Hub Preview** (`http://tizen.org/metadata/app_ui_type/base_screen_resolution` plus a Tizen background
     service or public preview JSON feed) requires partner-tier privileges and background service execution that retail
     firmware restricts for non-store apps.
2. **Vendor Lock-In & Portability**:
   - Wiring Continue Playing and Search into `tizen.application.ApplicationControl` and Samsung's proprietary preview
     schema locks the experience to Samsung Tizen.
   - Keeping Continue Playing (`GET/PUT /resume`) and Unified Search (`GET /search?q=`) inside `@secretary/server` and
     `@secretary/catalog-kit`'s in-app overlay means the exact same UI works on Samsung Tizen, LG webOS, Android TV, or
     any standard web browser with zero vendor-specific APIs.
3. **Zero App-Switching Latency**:
   - Launching a separate Tizen widget via `tizen.application.launch()` takes 2–3 seconds of cold boot.
   - By embedding the **Search & Hub Overlay** and in-place catalog switching directly inside `catalog-kit`, opening
     Search, browsing cross-category Continue Playing, or playing a Series/Anime from inside the Movies app happens
     instantaneously in the same webview without invoking Tizen's application manager.

## What was verified on the reference TV (GU43DU7199UXZG, Tizen 9)

- `tizen.application.getAppsInfo` returns 472 entries; most are internal services. The filter in `src/apps.ts`
  (store-style ids, no service/worker/agent/e-manual names, `show !== false`) leaves 9 real apps on this TV, with icons.
  Icon paths load straight into `<img>`.
- `tizen.application.launch(id)` opens another app: pressing OK on the Movies tile sent the launcher to `hidden`.
- Movies can launch the launcher again (`application.launch` privilege), so Back at Movies' root returns to the launcher
  when the build knows the launcher's id (`SECRETARY_TV_LAUNCHER_ID`, which becomes `<id>.Launcher`).
- Netflix, Prime and Disney+ do not appear in `getAppsInfo` on this TV. Pin them by id in `src/config.ts` if you find
  theirs; a pin bypasses the filters. The TV's Settings (`com.samsung.tv.coba.setting.networksettings`) is pinned.
- Size: 7.4 KB of JS gzipped, 21.5 KB `dist/`.

## Install

```bash
cd packages/launcher
SECRETARY_TV_LAUNCHER_ID=ScrtLaunch node ../tv-kit/scripts/tizen.mjs deploy
```

Put `SECRETARY_TV_LAUNCHER_ID=ScrtLaunch` in `.env.tizen` to make it permanent. Rebuild Movies afterwards so its Back
returns here. Uninstalling the launcher removes it cleanly; nothing else on the TV was touched.

## Autorun (you do this in the TV's own settings)

Samsung's menu names vary by firmware. Look for a start-up option along the lines of
Settings > General (or Smart Features) > Start-up options, and choose "Autorun Last App". The TV then opens whichever app
was running when it was switched off; leave the launcher (or any catalog app) running when you turn the TV off. Turn
"Autorun Smart Hub" off if it is separate. To undo, set the option back. I did not change this on your TV.

## Home button redirect: not done

Pressing the remote's Home key still opens Smart Hub. The only public project that redirects it is
[NelsonEU/arn0-tv](https://github.com/NelsonEU/arn0-tv). Its guide (docs/setup-tv.md there) says:

- It rewrites undocumented system preferences (`db/appfw/home_appid` and the main app-control entry, both from
  `com.samsung.tv.csfs` to the launcher's id) through native helpers run over `sdb`.
- Its runner is deliberately not published, and it was tested on one TV only (Tizen 6.5, one firmware). The guide
  says not to run it on other hardware and not to weaken its guards.
- A firmware update can undo or change the settings. It says to save a baseline of your TV's own values first, verify,
  then apply, and to restore the baseline before uninstalling the launcher.
- If Home is misdirected and `sdb` cannot reach the TV, its fallback is a Samsung Home entry in the launcher's own settings,
  and otherwise Samsung's support path.

I did not apply this. It changes system settings that I should not change on your TV, on a different model and Tizen
version than the one it was tested on, using code I do not have. If you want to attempt it yourself, rollback means:
read your TV's current values before touching anything, keep them outside the repo, restore them before uninstalling the
launcher, and have a way back that does not depend on the launcher (a second `sdb` route to the TV, or Samsung support).

## Where this leaves the idea

- **In-app Hub (Search and Settings)**: Always available inside Movies, Series, and Anime (CH- or the Search button)
  with cross-category Continue Playing and Unified Search, zero Tizen lock-in, and no app switch. The dashboard
  itself is Nest (CH+).
- **Boot into the launcher or last catalog app**: Workable with Autorun Last App, no system changes.
- **Home key to the launcher**: Unproven on this TV and risky; keep using CH+ and "Autorun Last App" instead.

## Glass components and the lab

`packages/tv-kit/src/glass` holds the floating translucent ("glass") components for the home screen: `GlassRoot`,
`Glass`, `Segmented`, `IconButton`, `DateChip`, `ListCard`, `MediaTile`, `Avatar`, `Fab` and `Scroller`. Import them by path
(`@secretary/tv-kit/src/glass/index.ts`) so the catalog apps do not load their CSS. The blur is faked: `blurBackdrop()` blurs
the page backdrop once and each surface shows its own piece of it, because a live `backdrop-filter` runs at about 15 fps on
the reference TV. Measurements are in `performance.md`.

To see the lab screen built from them, run this over the inspector, then press Red to cycle `flat`, `live` and `fake`, and Back
to return to the launcher:

```bash
node ../tv-kit/scripts/cdp.mjs <port> eval "localStorage.setItem('nest.lab','fake');location.reload()"
```

## Home screen layout and keys

The home screen (`src/home.tsx`) is a glass dashboard; `src/nest-nav.ts` moves focus between its areas and is unit tested.

| Area | Where | OK does |
| --- | --- | --- |
| Weather and clock | top left | opens the forecast over the Ask panel (next 6 hours, today and 3 days); Back closes it |
| Section pill: Nest, Cinema, Shows, Anime | top centre | opens that app (Nest is this screen) |
| Search, Lights, Bell | top right | opens search; cycles the Cinema, Warm and Off scenes; jumps to the first open reminder (the badge counts them) |
| Ask Nest chips | left, under the wave | Ask listens on the room microphone (or opens the TV keyboard, whose microphone dictates); the others send that prompt |
| Ask Nest results | right, in place of the apps and reminders | opens the title in its app; Back closes the row |
| App strip | top right, under the buttons | opens the app |
| Reminders | right column | marks it done or open again (on the server, or on the TV for its own) |
| Recent, then Continue Watching | bottom left | a Recent card goes back to that answer (the titles, the forecast, the lights, the reminder, or asks again); a tile opens the title in its app and resumes |
| + | bottom right | types a new reminder with the TV keyboard (on the server, or on the TV without one) |

Focus starts on the first app. CH- or Search opens search from anywhere, CH+ jumps to the Search button, the microphone key
asks Nest by voice (see "Room microphone"), Green cycles the theme (automatic, Daylight, Night), Blue mutes spoken replies, and Back twice leaves. Without a server, everything but the phone companion still works (see "Ask Nest on the TV").

## Ask Nest, weather and Daylight

Ideas taken from a light, glassy TV concept video: an assistant panel with a voice wave, answers that lay out titles next
to it, an artwork-coloured glow, a quiet weather and clock header, a Recent row and a light theme. Its shopping flow is
out of scope, and so are its small grey text, large soft shadows and all-white screen at night.

- **Ask Nest** (`src/assistant.ts`, the panel in `home.tsx`) shows the conversation: up to three earlier prompts above
  the current one, each older one fainter, then the answer and the wave (`VoiceWave` in tv-kit glass) and four chips.
- **The wave follows the voice.** While the room microphone records, each frame's level drives it (`record(onLevel)`);
  while a spoken reply plays, a loudness envelope worked out from the WAV before playback does (`envelope()` in
  `src/voice.ts`, 50 ms steps), so the audio never goes through Web Audio and `setSinkId` still picks the speakerphone.
  `setWaveLevel()` writes each ribbon's `scaleY` straight to the DOM (no Preact render), and the ribbons ease towards
  the level at their own pace. Cool ribbons while the room speaks, warm ones while Nest answers (two sets swapped by
  opacity). Without a live level the wave is idle, listening, thinking or speaking, as before.
- **Answers take the stage**: titles from a watch prompt replace the apps and reminders on the right, four posters
  across, until Back. Every answer also becomes a card in **Recent** (bottom left, before Continue Watching), with home
  alerts from SmartThings ("the vacuum finished"): Watch, Reminder, Lights, Weather, Briefing and Home cards.
- Prompts go to the server's `POST /ai/ask` with `source: "tv"` when a server is configured and up. Nest polls
  `GET /ai/state` every 2.5 s while the home screen is up, so prompts typed on the phone companion show on the TV too
  ("From your phone"). The server keeps the last 8 turns in memory only.
- **Watch prompts** (`packages/assistant/src/intent.ts`): "play dune", "show me a comedy", "something for tonight",
  "find me scary anime". A named title is searched; a kind or genre alone browses Cinemeta's top catalogs (Kitsu's
  trending or popular for anime).
- "light theme", "dark mode" and "auto theme" are answered on the TV, and so is a light, a scene or the vacuum by name
  (SmartThings from the TV).
- **Glow**: the focused tile gets a halo in its artwork's colour. Artwork hosts send no CORS headers, so Nest reads the
  colour through `GET /art?u=` (metahub, Kitsu, TMDB and fanart.tv only). Without a server the glow uses the app's tint.
  The halo is a blurred canvas drawn once per colour, moved and faded with transform and opacity.
- **Daylight** (`drawBackdrop(tint, "day")` and the `sg-day` class): pale glass on a lavender and pink wash. Automatic
  by default (07:00–18:59), Green or a theme prompt changes it, and the choice is kept in `localStorage["nest.theme"]`.

## Ask Nest on the TV

The answers live in `packages/assistant` (`route()`), which the server and Nest share. Nest runs it itself
(`src/brain.ts`) when it has no server or the server is down, so the server is optional:

- **Reminders** are kept on the TV (`localStorage["nest.reminders"]`, source "local", shown as "Added on the TV") next to
  the server's.
- **Lights** go to SmartThings from the TV (`runLights()` in `src/home-control.ts`): the movie scene picked in Lights or
  a scene with a fitting name ("cinema", "warm", "off"), else every light at 15 %, 70 % or off.
- **Watch prompts and Spotlight Search** ask the catalogs straight from the TV.
- **The weather** ("what's the weather", "do I need an umbrella") is answered from the forecast, with no Gemini call.
- **Gemini** (free questions, the briefing, voice and spoken replies) needs `NEST_GEMINI_API_KEY` in `.env.tizen`. It has
  its own name because `tizen.mjs` also reads `.env`, and the server's `GEMINI_API_KEY` must not end up in a `.wgt`
  unasked. The key ships inside the package: restrict it to the Generative Language API. With it, Nest transcribes and
  speaks on the TV even when a server is up (one hop less); without it, voice still goes through the server.

## Weather

`src/weather.ts`, Open-Meteo straight from the TV (no key, CORS open). The place is the SmartThings home's coordinates
(`locations()` in `packages/smartthings`, looked up once a day), else `WEATHER_LAT`/`WEATHER_LON` or `WEATHER_CITY` from
`.env.tizen` (a city is geocoded once). Both are kept in `localStorage["nest.place"]`; when SmartThings is down the last
home still serves. The forecast (now, the next 6 hours, today and 3 days) is refreshed every 30 min and kept in
`localStorage["nest.weather"]`, so the header has weather from the first frame after a restart (not when older than
3 h). The server's `GET /weather` is only asked when the TV knows no place. Icons are one-colour line glyphs drawn as CSS
masks, so they take the theme's ink.

## Room microphone

A USB speakerphone on the TV (a Jabra Speak 510 here) can be Ask Nest's microphone and speaker, so nobody has to hold
the remote up to their mouth. It has to be plugged into the TV: the server may run anywhere, even in the cloud, and only
ever sees the recorded clip. Bluetooth to the TV does not work for this, since Samsung TVs pair Bluetooth audio as an
output only.

- **Flow** (`src/voice.ts`, `listen()` in `app.tsx`): the microphone key (or the Ask chip) records from the first input
  whose name looks like a speakerphone ("Jabra", "Speakerphone", "Conference"), else the default input. The clip ends after
  1.2 s of quiet following speech, after 6 s with no speech, at 15 s, or on the key again. Nest encodes it as 16 kHz WAV
  with Web Audio (Gemini does not list WebM, and MediaRecorder varies on TVs) and sends it to Gemini, from the TV with
  `NEST_GEMINI_API_KEY` or through the server's `POST /ai/transcribe`, which returns only the words. Nest then sends them through `/ai/ask` like a typed prompt, so "dark mode" stays on the
  TV and never reaches the lights.
- **Spoken replies**: voice prompts ask `/ai/ask` with `speak: true`, and the server adds the reply as WAV from a Gemini
  speech model (`GEMINI_TTS_MODEL` puts another model first). Nest plays it on
  the speakerphone's own output when it has one (`setSinkId`; the TV would otherwise keep its own speakers), and the
  wave speaks until it ends. Blue mutes or unmutes this
  (`localStorage["nest.speak"]`).
- **Fallbacks**: if the TV gives the app no microphone, or the server has no `GEMINI_API_KEY`, the key opens the TV
  keyboard as before for the rest of the session. Secretary Desk has a "Hold" button that records on the phone (a
  speakerphone paired to the phone over Bluetooth works there); phones only open the microphone on https or localhost.
- **Privilege**: `http://tizen.org/privilege/mediacapture` in `tizen/config.xml.tpl`.

### Checking a TV

Verified on the reference TV (GU43DU7199UXZG, Tizen 9, Chromium 120) on 2026-10-31 with a Jabra Speak 510 on USB:

- The TV lists it as both input and output (`usb-0b0e_Jabra_SPEAK_510_USB_... (usb audio)`). `getUserMedia` succeeds
  with the mediacapture privilege, and the track is the Jabra. Web Audio runs at 44.1 kHz with `createScriptProcessor`.
- Spoken prompts went end to end: "Remind me to water the plants" added the reminder, and "Play the movie Avatar"
  showed the titles. Gemini punctuates transcripts like dictation, so `transcribe()` drops a closing full stop
  (otherwise it lands in the reminder text).
- Spoken replies play on the Jabra (`setSinkId`) and were heard. The first try was silent for about 25 s: the server
  asked `gemini-3.6-flash` first, which took 16 s for one sentence (the lite models answer in under 1 s). With the lite
  models first and 8 s per model, a briefing with its 9 s spoken reply comes back in about 6.7 s.

Again on 2026-11-01 with Gemini called from the TV (`NEST_GEMINI_API_KEY`) and the live wave, three prompts spoken at the
Jabra:

- The wave followed the voice while listening (cool ribbons, height 0.33 on average, up to 1.09) and the reply while it
  played on the Jabra (warm ribbons, 0.81 on average, up to 1.17), and went back to idle after each.
- "What's the weather?" and "Remind me to water the plants at 6" were transcribed and answered about 1.2 s after the
  speaker stopped. The spoken reply then took another 4-4.5 s to arrive from the speech model; the wave stays on
  "thinking" meanwhile.
- "Give me a briefing" was taken as a title to search, since "give me" leads a watch prompt. The intent parser now
  leaves the briefing, news, summary, weather and forecast alone.
- One press heard nothing for 6 s and said "Didn't hear anything", as designed.
- Over the 3 minutes, 21 of about 11,000 frames were over 50 ms (worst 333 ms): a new AudioContext per recording, the
  reply's base64 round trip and a new Recent card arriving with each answer. docs/performance.md, "Voice", has the fixes.
- The briefing had no voice because Gemini's free speech quota was used up (429 from both speech models).

To check another TV, plug in the speakerphone, deploy Nest with the privilege above, and run:

```bash
node ../tv-kit/scripts/cdp.mjs <port> eval "navigator.mediaDevices.getUserMedia({audio:true}).then(s=>navigator.mediaDevices.enumerateDevices()).then(d=>d.filter(x=>x.kind==='audioinput').map(x=>x.label))"
```

A list with the speakerphone's name means Nest can use it. A rejection (NotAllowedError, NotFoundError or no
`mediaDevices`) means that TV keeps the microphone to itself: use the Desk button instead.
