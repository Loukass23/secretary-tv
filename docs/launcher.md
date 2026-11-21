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

The home screen (`src/home.tsx`) follows the concept video: the person top left; a small clock and quiet buttons top
right; and one row of content cards running off the right edge (`src/cards.tsx`): the Assistant first, then Weather and
Calendar (one full card each), Recent, one card per app, and Add to home last. The assistant also sits under the cards,
in two modes (below). `src/nest-nav.ts` moves focus between them and is unit tested.

| Area | Where | OK does |
| --- | --- | --- |
| Profile | top left; under the name, an icon for Nuvio sync and one for the server (an alert dot when it is offline), or a line when something needs doing | opens the profile menu: what the TV is connected to in words, then Switch profile (or Sign in to Nuvio), TV settings, Theme, Spoken replies; Back closes it |
| Watch together, Search, Lights, Bell | top right, no fill until focused | the party; search; the Lights panel (or the next scene); the first open reminder in its card (the badge counts them) |
| Assistant (first card) | the greeting, the open reminders and the last exchange | the **full chat**: the cards defocus (dimmed, blurred) and the orb moves to the middle of the screen. Opening it starts listening: the line (blue while you speak, amber while Nest answers) shows only then, and your words and the answer are written around it; otherwise it is the orb. OK or the mic key listens again, Back returns to this card |
| Weather | a full card: now, the next 5 hours and the next 4 days | OK says it in the toast; the old forecast drop-down is gone |
| Calendar | a full card: today's date and the month, today marked | OK goes to the reminders (events come later) |
| Assistant under the cards | fixed at the bottom centre, under the orb | the **compact** mode. Down from a card or the last line inside one focuses it **and starts listening at once**; the ribbons show only while the room speaks or Nest answers, otherwise it is the orb (pulsing faster while it thinks), with a line of text under it (status, the answer, or "Press OK to talk"). Leaving it drops the clip. What it is asked moves focus to the card concerned: films open Cinema (or Shows, Anime) onto the picks, with what you asked and what the assistant did shown beside the card's label; the weather opens Weather, a reminder opens Reminders, the lights focus Home. Back returns to the first card |
| Recent | after Today, while there is an answer | goes back to that answer (the picks, the weather, the lights, the reminder, or asks again) |
| Continue · Cinema | a tall poster (the card's style) | opens the card: every film; a film resumes or opens; with nothing in progress, tonight's picks |
| Next up · Shows | two stacked stills | opens the card: every show, then "Open Shows"; resumes the episode or opens the show |
| Anime | a 3×2 grid of covers | opens the card: every title, then "Open Anime"; resumes or opens the title |
| My List, genre rows | not cards of their own: rows under the picks inside each opened media card (`src/mylist.ts`, `src/discover.ts`) | The rows are drawn like the picks row: same tiles, each rising in a beat apart when the row is reached, and the focused title's caption (name, line, three lines of synopsis in a fixed panel with room of its own) under them. Down from the picks in an opened Cinema, Shows or Anime card goes to its My List (that kind's titles from the Nuvio library, cached per profile), then its genre rows (Cinemeta genres; Kitsu for anime), the stack sliding up by transform; OK on a title opens its page (inside Nest with `NEST_EMBED_CATALOG=1` or `NEST_EMBED_PLAYER=1`, else in the catalog app); Up from the picks folds the card |
| YouTube | three popular videos as wide thumbnails (`src/youtube.ts`, the Data API with `NEST_YOUTUBE_API_KEY`, kept for an hour); without a key a one-line card | opens the video in the TV's YouTube app (a view app-control with the watch address, else a plain launch; `NEST_YOUTUBE_APP_ID` if the TV's app id differs from the default). **To confirm on the TV:** the app id and that it takes the address |
| Nuvio collections | one card per collection of the profile, its first four folders as cover tiles, two across (`src/collections.ts`, pulled with the Nuvio session, cached per profile) | opens that folder in the catalog app that fits it (the launch payload's `folder`; the app opens it once its collections are in). Cards are `nuvio:<id>`, so they can be moved and removed like the others |
| Home | the lights, the room's lux, then Cinema / Warm / Off | runs that scene (SmartThings from the TV, else through the server) |
| Reminders | up to three cards and "+ Add reminder" | marks it done or open again; adds one with the TV keyboard |
| Apps | the TV's other apps, two to a line | opens the app |
| Add to home | the last card, listing what was removed | puts that element back on the home screen; with nothing removed it says so |

Left and Right move from card to card, a ring around the whole card. OK goes inside it, on its first item. A long OK on
a card (`useOkHold`, 600 ms) opens its menu: on a media card the style menu with "Remove from home" as its last line, on
the others a menu with that one line. Removed cards are kept in `localStorage["nest.hiddenCards"]` (`src/home-cards.ts`);
the Assistant and Add to home cards stay. A card is removed or put back without restarting. Inside,
the arrows stay in the card, Up from the top goes back to the card, and Back leaves it.

### Moving cards (long OK, "Move")

Both long-OK menus have a **Move** line (before "Remove from home"). OK on it lifts the card (a small scale on its own
layer) and the others step back; Left and Right swap it with its neighbour, and the row slides by transform as when a
card opens. OK keeps the order, Back puts the old one back. The Assistant stays first and Add to home last. The order is
saved in `localStorage["nest.cardOrder"]` (`src/card-order.ts`): cards it does not know keep their default place, and
the saved keys of removed cards are kept so a card put back finds its place.

### Opening a media card

Cinema, Shows and Anime hold up to 8 titles each: what is in progress first, then the catalog's picks. OK opens the card
in place into one row of all of them, at the Ask results size (`src/cards.tsx`,
`MediaRow`). The cards after it slide right by transform and every other card steps back to 35% opacity; the folded
tiles fade out and the titles rise in a beat apart (opacity and transform only, on their own layers). Focus lands on the
first title. The focused title's name, its line (episode or year) and up to three lines of its synopsis sit in a fixed
panel at the left under the row (from the catalog, or Cinemeta and Kitsu for titles in progress). Up or Back folds the card again.

### Title menu (long OK on a tile)

Inside an opened Cinema, Shows or Anime card, a short OK on a title acts on the keyup (resumes it, or opens its page) and a
held one (600 ms) opens the title's menu: Open details, Play or Resume, Mark watched, Add to or Remove from My List (the
lines are catalog-kit's `titleMenu`, minus the ones that need the page). While OK is held a pill at the top right
(`HoldPill` in tv-kit glass) shows after 150 ms with a bar that fills, "Hold for options", then "Release for options";
a tap never shows it. The closed cards' long OK (below) shows it too. The rows under the picks (My List, genres) have the same menu, and on a pick it also holds "Remove from
suggestions" (`src/dismissed.ts`; the next trending title takes its place). Watched and My List are written through catalog-kit's local stores; they reach the Nuvio account the next
time the catalog runs.

### Opened card: rows, headers and looks

The opened card has no Open tile any more (the catalog runs inside Nest). The header names where the remote is, as a
breadcrumb with a count ("Cinema › My List  12 films") and a hint on the right; the first row is "Continue watching",
"Tonight's picks" or "For you". Every row below (My List, genres) is drawn like the first: the same tiles rising in a
beat apart when the row is reached, and the focused title's caption (name, line, three lines of synopsis) in a panel with
room of its own. The row under the focused one is drawn dimmed, its label and the top of its tiles showing under the
caption, so Down has something to go to.

Each row has its own look, set from the title menu's last line ("Row look", Left and Right or OK change it at once,
kept per row on the TV, `src/row-look.ts`): Poster, Landscape, Square, Highlight 4:3 (the catalog apps' card shapes,
`collectionlayout.ts`) and Ranking (big numerals beside the posters, the idea of Nuvio Legacy's ranking view; ideas only,
no code from it). Landscape and 4:3 use the title's background art when it has one.

### Card styles (long OK)

A long OK (held 600 ms; `useOkHold` in tv-kit, as the catalog's collection rows) on Cinema, Shows or Anime opens a menu
beside it: Poster, Stills, Grid or Row, and a size (Small, Medium, Large); every layout is the same height at a size. The card previews each line as the remote
reaches it; OK keeps it, Back puts the old style back. Styles are saved on the TV (`localStorage["nest.cardStyles"]`,
`src/card-style.ts`); the defaults are today's (a poster, two stills, a grid). A short OK on such a card acts on the
keyup, so the hold can be told apart; OK everywhere else still acts on the keydown. Up from a card goes to the header. The row and the assistant scroll as one strip: once a card would pass the right edge, the row moves left and the
assistant slides off and fades with it (transform and opacity, on the row's timing), so the cards get the whole width.
Back at the first cards, or on Ask Assistant, it slides back in. All the cards are drawn (seven at most).
Trending titles come from the catalogs straight from the TV once a day (`localStorage["nest.trending.2"]`).

Focus starts on the first card. CH- or Search opens search from anywhere, CH+ jumps to the Search button, the microphone
key asks Nest by voice (see "Room microphone"), Green cycles the theme (automatic, Daylight, Night), Blue mutes spoken
replies, and Back twice leaves. Without a server, everything but the phone companion still works (see "Ask Nest on the TV").

## Ask Nest, weather and Daylight

Ideas taken from a light, glassy TV concept video: an assistant panel with a voice wave, answers that lay out titles next
to it, an artwork-coloured glow, a weather and calendar cards, a clock, a Recent row and a light theme. Its shopping flow is
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
`localStorage["nest.weather"]`, so the weather card has it from the first frame after a restart (not when older than
3 h). The server's `GET /weather` is only asked when the TV knows no place. Icons are one-colour line glyphs drawn as CSS
masks, so they take the theme's ink.

## Room microphone

A speakerphone on the TV (a Jabra Speak 510 here) can be Ask Nest's microphone and speaker, so nobody has to hold
the remote up to their mouth. It has to be connected to the TV, by USB or Bluetooth: the server may run anywhere, even
in the cloud, and only ever sees the recorded clip. Over Bluetooth the reference TV lists the microphone as
`Jabra SPEAK 510 USB (bluetooth voice)` and the speaker as `BluetoothMedia (bluetooth media)`, so the speaker label has
no product name and `ROOM_DEVICE` also matches "bluetooth". Pair it in the TV's Bluetooth speaker list; the voice
profile is what makes the microphone appear.

- **Flow** (`src/voice.ts`, `listen()` in `app.tsx`): the microphone key (or the Ask chip) records from the first input
  whose name looks like a speakerphone ("Jabra", "Speakerphone", "Conference"), else the default input. The clip ends after
  1.2 s of quiet following speech, after 6 s with no speech, at 15 s, or on the key again. Nest encodes it as 16 kHz WAV
  with Web Audio (Gemini does not list WebM, and MediaRecorder varies on TVs) and sends it to Gemini, from the TV with
  `NEST_GEMINI_API_KEY` or through the server's `POST /ai/transcribe`, which returns only the words. With
  `NEST_GROQ_API_KEY` as well, the TV sends the clip to Groq's Whisper first (`transcribeGroq`, about 0.4 s against
  Gemini's 1.9 s on 2026-11-20) and falls back to Gemini when Groq refuses; answers and spoken replies stay on Gemini. Noise never becomes a question:
  a clip needs 250 ms of voice-level sound to be sent at all (`MIN_SPEECH_MS`), and Groq's segments with a
  `no_speech_prob` of 0.6 or more are dropped (Whisper otherwise invents "Thank you." from silence). Either way Nest says
  "Couldn't hear anything" and nothing reaches the assistant. Entering the assistant hides earlier exchanges from it. Nest then sends them through `/ai/ask` like a typed prompt, so "dark mode" stays on the
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
