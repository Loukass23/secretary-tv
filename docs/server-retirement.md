# Retiring the home server

The home server (`packages/server`, Secretary Server and Secretary Desk) is being retired: Secretary should work
from the TV alone, with Nuvio Cloud, SmartThings and the assistant's own keys. This is the inventory of everything
the TV still asks the server for, checked on 2026-11-25 by grepping the repo for `SERVER_URL`, `serverUrl`,
`setResumeServer` and the server's routes (`packages/server/src/app.ts`).

**Status: inventory only.** Search is the one feature moved this round (first row). Nothing else here has been
changed; each row says what replaces it on the TV, or that it goes, and roughly what it costs.

Effort: **S** is up to half a day, **M** one to two days, **L** three days or more. Each estimate includes tests
(`node --test`, fake responses) and the doc it touches, not a TV measurement.

## How the TV finds the server

`SECRETARY_TV_SERVER_URL` in `.env.tizen` is built into Secretary as `SERVER_URL`
(`launcher/src/config.ts`, `launcher/vite.config.ts`, `tv-kit/scripts/tizen.mjs`). Empty means no server, and every
feature below already has a no-server branch, except where the table says otherwise. The catalog gets the same
address as `serverUrl` (`launcher/src/catalog-host.tsx` → `catalog-kit/src/app.tsx`).

## Inventory

| # | Feature | Server route | Where on the TV | Replacement on the TV, or removal | Effort |
| --- | --- | --- | --- | --- | --- |
| 1 | **Search** | `GET /search` | `findTitles` in `launcher/src/app.tsx` | **Done in this round.** `findCatalogs` (`assistant/src/search.ts`) queries the catalogs straight from the TV, with an 8 s timeout, cancellation per keystroke and an error instead of an endless wait. | done |
| 2 | **Phone keyboard by QR code** | `GET/POST /type/<code>/text` | `launcher/src/phone-keys.ts`; the QR code in `search.tsx` (`desk` prop) | Remove the QR code and `phone-keys.ts`: the TV's own keyboard (the remote's voice/IME key, `getTvInputBridge`), the panel's keys and a USB keyboard remain. If phone typing is wanted later, relay it through the watch-party Worker (`packages/party`), which already pairs devices by code. | S remove, M relay |
| 3 | **Reminders** | `GET /reminders`, `POST /reminders`, `POST /reminders/<id>/toggle` | `fetchReminders`, `addReminder`, `toggleReminder` in `launcher/src/apps.ts`; their calls in `app.tsx` (adding, the home poll, `refreshServer`, toggling a card item) | Keep only the TV's own reminders (`localReminders` in `launcher/src/brain.ts`, already used when there is no server) and drop the merge with the server's list. Reminders then live on one TV; no phone sync. `fetchRemindersForMode` and `toggleReminderForMode` (`catalog-kit/src/lib/settings.ts`) are exported but used by nothing: delete them. | S |
| 4 | **The assistant's answers** | `POST /ai/ask`, `GET /ai/state` | `askNest`, `fetchAssistant` (`launcher/src/assistant.ts`); `app.tsx` asks the server first when it is online and polls `/ai/state` on the home screen | **Done.** `localBrain` (`launcher/src/brain.ts`) answers every prompt on the TV with `route()` from `packages/assistant`; `askNest`, `fetchAssistant`, the `/ai/state` poll and `mergeTurns` are removed. | done |
| 5 | **Speech-to-text fallback** | `POST /ai/transcribe` | `transcribeClip` in `assistant.ts`; `app.tsx` uses it when the TV has neither `GEMINI_KEY` nor `GROQ_KEY` | **Done.** The TV transcribes itself with either key (`transcribeOnTv`), and `transcribeClip` is removed. Without a key, voice and auto-listen are off (`mayListen` / `speaksReply`) and Settings › Home screen says why. | done |
| 6 | **Spoken replies** | the `speech` field of `/ai/ask` | `askNest(…, wantSpeech)` in `app.tsx` | **Done (with row 4).** Spoken on the TV by Gemini (`speak` from `packages/assistant`) when `NEST_GEMINI_API_KEY` is set. | done |
| 7 | **Weather fallback** | `GET /weather` | `fetchWeather` in `assistant.ts`; `app.tsx` uses it when the TV knows no place | The TV's own forecast (`launcher/src/weather.ts`, the `WEATHER_ENV` place). Without a place, no weather card, or a place picked in Settings. | S |
| 8 | **Artwork colour proxy** | `GET /art?u=` | `artProxy` in `assistant.ts`; the focused poster's glow and mood in `app.tsx` | Read the colour straight from the image host (already tried first); when a host refuses, fall back to the kind's tint (`KIND_TINT`, already the last step). Remove the proxy step. | S |
| 9 | **Light scenes** | `POST /domotics/command` | `setScene` in `apps.ts` and its two calls in `app.tsx` (the scene buttons); `runMovieScene` in `catalog-kit/src/lib/home.ts` (dimming for a film when SmartThings did not take it); the Lights card's "Through Secretary Server" line | SmartThings from the TV (`packages/smartthings`, `homeConfigured()`, `playbackLights`), already first. Remove the server branch; without SmartThings the scenes say "SmartThings not set up". The server's simulated devices go with it. | S–M |
| 10 | **Continue watching sync** | `GET /resume`, `GET/PUT /resume/<kind>` | `refreshServer` and `forgetProgress` in `app.tsx`; `setResumeServer`, `pushResume`, `syncResume`, `syncAllResume` and the rest of the server half of `catalog-kit/src/lib/resume.ts` | Nuvio Cloud, the default backend (`SYNC_BACKEND` unset), already syncs progress, My List and collections. Remove the `secretary` backend (`SYNC_BACKEND=secretary`, `cloudEnabled` false), its resume code and tests; the TV keeps its local list when signed out. | M |
| 11 | **"Server online" status** | `/resume` used as a health check | `serverOnline` in `app.tsx`: the header's server icon, the menu line "Server online · CH- to search", the server-first gate of row 4 | Remove with rows 3, 4 and 10. | S |
| 12 | **Hand-off from the phone** | `POST /handoff`, `GET /handoff/<kind>` | `consumeHandoff` in `catalog-kit/src/lib/resume.ts` | Nothing on the TV calls it any more: delete. A phone that opens a title on the TV is a Nuvio-app or watch-party feature if wanted again. | S |
| 13 | **Streams fallback** | `GET /stream/<type>/<id>.json`, `GET /resolve/<hash>`, `/manifest.json` | `createStreamClient(serverUrl, …)` in `catalog-kit/src/app.tsx`, the fallback behind `createPluginStreamClient` (8 s cap) | The plugins on the TV (`packages/plugins`) and debrid from the TV (`packages/core`) find and resolve streams already. Before removing, check on the TV that every kind the server resolved (cached debrid links, file choice per episode, the redirect the player follows) resolves from the TV, then drop the fallback (`createStreamClient`, `fallbackMs`). The risk is titles that today only play through the server. | M–L |
| 14 | **Debrid cloud list** | `GET /cloud` | none on the TV (Desk only) | Goes with the server. | none |
| 15 | **Secretary Desk** (phone companion) | `/companion`, `/remote`, `/health` | the flash "ask from your phone at …/companion" when the TV has no keyboard (`app.tsx`) | No TV-side replacement: the phone app goes. Change the flash to "No TV keyboard here" (the no-server text). Reminders and the assistant on the phone are lost unless they come back through Nuvio or the party Worker later. | S |
| 16 | **Build, deploy and hosting** | n/a | `SECRETARY_TV_SERVER_URL` (`.env.tizen.example`, `tizen.mjs`, `launcher/vite.config.ts`, `config.ts`), `SERVER_URL` in `design/vite.config.ts`, the `serverUrl` prop of `CatalogHost` and `CatalogApp`, the root `Dockerfile`, `docs/hosting.md`, the README's server sections, `packages/server` | Last, once rows 2 to 15 are done: remove the setting, the prop, the Docker image and the package, and the server's CI tests. Removing the server code paths frees part of Secretary's gzip budget (`budget.json`). | S |

## Order

1. Rows 3 to 9, 11, 12 and 15 are small and independent: each already has the TV-side path, so the work is deleting
   the server branch and its tests. They can go in one PR.
2. Row 10 after that, with a check that a fresh TV signed in to Nuvio fills Continue watching.
3. Row 13 needs a TV session to compare what plays with and without the server; do it before row 16.
4. Row 2 whenever the search screen is next touched (it is the last server call on that screen).
5. Row 16 closes the retirement.
