import { kvGet, kvReadPersisted, kvSetAsync } from "./kv-db";

export const PERSONAL_NOTE_TIMER_EVENT = "personal-note-timer-updated";
const TIMER_KEY = "ai_phone_personal_note_timer_v1";
const REMEMBER_KEY = "ai_phone_personal_note_remember_v1";

export type PersonalNoteTimerSettings = {
  enabled: boolean;
  characterIds: string[];
  delayMinutes: number;
  epoch: string;
};

function parseSettings(raw: string | null): PersonalNoteTimerSettings {
  const stored = JSON.parse(raw || "{}") as Partial<PersonalNoteTimerSettings>;
  return { enabled: false, characterIds: [], delayMinutes: 0, epoch: "", ...stored };
}

export function loadPersonalNoteTimerSettings() {
  return parseSettings(kvGet(TIMER_KEY));
}

export async function loadPersistedPersonalNoteTimerSettings() {
  return parseSettings(await kvReadPersisted(TIMER_KEY));
}

export async function savePersonalNoteTimerSettings(settings: PersonalNoteTimerSettings) {
  const previous = loadPersonalNoteTimerSettings();
  const epoch = previous.enabled === settings.enabled
    ? previous.epoch
    : globalThis.crypto?.randomUUID?.() || String(Date.now());
  await kvSetAsync(TIMER_KEY, JSON.stringify({ ...settings, epoch }));
  window.dispatchEvent(new Event(PERSONAL_NOTE_TIMER_EVENT));
}

export function loadPersonalNoteRemember() {
  return kvGet(REMEMBER_KEY) !== "false";
}

export async function savePersonalNoteRemember(remember: boolean) {
  await kvSetAsync(REMEMBER_KEY, String(remember));
}

export async function loadPersistedPersonalNoteRemember() {
  return (await kvReadPersisted(REMEMBER_KEY)) !== "false";
}

export const noteTimerClaimPrefix = (id: string) => `personal-note-timer-claim:${id}:`;
