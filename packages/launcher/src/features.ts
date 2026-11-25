// The features a viewer can switch off in Settings › Home screen (catalog-kit lib/settings.ts, `home`). Each gate is
// pure so it is tested; app.tsx passes everything that feature shows or does through its gate.
import type { DashboardSettings } from "@secretary/catalog-kit/src/lib/settings.ts";

export type HomePrefs = DashboardSettings["home"];

/** Reminders: the Reminders card, the bell's count and the assistant's greeting see none while they are off. */
export const remindersShown = <T>(prefs: Pick<HomePrefs, "reminders">, items: readonly T[]): T[] => (prefs.reminders ? [...items] : []);

/** Home notifications: what SmartThings reported changing, toasted and kept in the Recent card, or nothing. */
export const alertsShown = <T>(prefs: Pick<HomePrefs, "homeAlerts">, news: readonly T[]): T[] => (prefs.homeAlerts ? [...news] : []);

/** Spoken replies: an answer is read aloud only after a voice question, and only while they are on. */
export const speaksReply = (prefs: Pick<HomePrefs, "spokenReplies">, spoken: boolean): boolean => spoken && prefs.spokenReplies;

/**
 * Listening on focus: the microphone opens by itself when focus reaches the assistant only while this is on. OK and the
 * mic key still listen (`auto` false).
 */
export const mayListen = (prefs: Pick<HomePrefs, "listenOnFocus">, auto: boolean): boolean => !auto || prefs.listenOnFocus;
