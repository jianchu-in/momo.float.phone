import { kvGet, kvReadPersisted, kvSetAsync, kvUpdatePersisted } from "./kv-db";

export const PERSONAL_NOTE_TIMER_EVENT = "personal-note-timer-updated";
const TIMER_KEY = "ai_phone_personal_note_timer_v1";
const REMEMBER_KEY = "ai_phone_personal_note_remember_v1";

export type PersonalNoteTimerSettings = {
  enabled: boolean;
  characterIds: string[];
  delayMinutes: number;
  remember: boolean;
  sendMessage: boolean;
  epoch: string;
};

function parseSettings(raw: string | null, remember: boolean): PersonalNoteTimerSettings {
  const stored = JSON.parse(raw || "{}") as Partial<PersonalNoteTimerSettings>;
  return { enabled: false, characterIds: [], delayMinutes: 0, remember, sendMessage: false, epoch: "", ...stored };
}

export function loadPersonalNoteTimerSettings() {
  return parseSettings(kvGet(TIMER_KEY), loadPersonalNoteRemember());
}

export async function loadPersistedPersonalNoteTimerSettings() {
  const [timer, remember] = await Promise.all([kvReadPersisted(TIMER_KEY), kvReadPersisted(REMEMBER_KEY)]);
  return parseSettings(timer, remember !== "false");
}

export async function savePersonalNoteTimerSettings(settings: PersonalNoteTimerSettings) {
  await kvUpdatePersisted(TIMER_KEY, raw => {
    const previous = parseSettings(raw, settings.remember);
    const epoch = previous.enabled === settings.enabled
      ? previous.epoch
      : globalThis.crypto?.randomUUID?.() || String(Date.now());
    return JSON.stringify({ ...settings, epoch });
  });
  window.dispatchEvent(new Event(PERSONAL_NOTE_TIMER_EVENT));
}

export function loadPersonalNoteRemember() {
  return kvGet(REMEMBER_KEY) !== "false";
}

export async function savePersonalNoteRemember(remember: boolean) {
  await kvSetAsync(REMEMBER_KEY, String(remember));
}

export const noteTimerClaimPrefix = (id: string) => `personal-note-timer-claim:${id}:`;
