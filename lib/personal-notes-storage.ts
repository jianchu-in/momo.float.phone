import { loadPersistedPersonalNoteTimerSettings, noteTimerClaimPrefix, PERSONAL_NOTE_TIMER_EVENT } from "./personal-note-timer-settings";
import { kvGet, kvReadPersisted, kvRemoveClaims, kvUpdatePersisted, registerKvMigration } from "./kv-db";

export const PERSONAL_NOTES_KEY = "ai_phone_personal_notes_v1";
registerKvMigration(PERSONAL_NOTES_KEY);

export type PersonalNoteKind = "diary" | "memo";
export type MemoStyle = {
  paper: "plain" | "lined" | "grid" | "dotted";
  mode: "text" | "todo";
  numbering: "none" | "bullet" | "number" | "letter";
  checked: number[];
};

export const DEFAULT_MEMO_STYLE: MemoStyle = { paper: "lined", mode: "text", numbering: "none", checked: [] };

export type PersonalNote = {
  id: string;
  identityId: string | null;
  kind: PersonalNoteKind;
  title: string;
  body: string;
  date: string;
  updatedAt: string;
  memoStyle?: MemoStyle;
  autoPeek?: { dueAt: number; epoch: string; characterIds: string[] };
};

function parseNotes(current: string | null): PersonalNote[] {
  if (current === null) return [];
  const parsed: unknown = JSON.parse(current);
  if (!Array.isArray(parsed)) throw new Error("无法读取手记数据");
  return parsed;
}

export async function loadPersistedPersonalNotes(): Promise<PersonalNote[]> {
  return parseNotes(await kvReadPersisted(PERSONAL_NOTES_KEY));
}

export function loadPersonalNotes(identityId: string | null, kind: PersonalNoteKind): PersonalNote[] {
  return parseNotes(kvGet(PERSONAL_NOTES_KEY))
    .filter(note => note && note.identityId === identityId && note.kind === kind)
    .sort((a, b) => kind === "diary"
      ? b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt)
      : b.updatedAt.localeCompare(a.updatedAt));
}

function updateNotes(update: (notes: PersonalNote[]) => PersonalNote[]): Promise<void> {
  return kvUpdatePersisted(PERSONAL_NOTES_KEY, value => JSON.stringify(update(parseNotes(value))));
}

export async function savePersonalNote(note: Omit<PersonalNote, "updatedAt">): Promise<void> {
  if (!note.title.trim() && !note.body.trim()) throw new Error("请填写标题或正文");
  if (note.kind === "diary" && !/^\d{4}-\d{2}-\d{2}$/.test(note.date)) throw new Error("请选择日记日期");
  const settings = await loadPersistedPersonalNoteTimerSettings();
  await updateNotes(notes => {
    const index = notes.findIndex(item => item?.id === note.id);
    const autoPeek = index >= 0 ? notes[index].autoPeek : settings.enabled && settings.characterIds.length
      ? { dueAt: Date.now() + settings.delayMinutes * 60_000, epoch: settings.epoch, characterIds: settings.characterIds }
      : undefined;
    const saved = { ...note, title: note.title.trim(), updatedAt: new Date().toISOString(), autoPeek };
    if (index < 0) return [...notes, saved];
    if (notes[index].identityId !== note.identityId || notes[index].kind !== note.kind) throw new Error("无法更新这条手记");
    notes[index] = saved;
    return notes;
  });
  window.dispatchEvent(new Event(PERSONAL_NOTE_TIMER_EVENT));
}

export async function deletePersonalNote(id: string, identityId: string | null, kind: PersonalNoteKind): Promise<void> {
  await updateNotes(notes => notes.filter(note => note?.id !== id || note.identityId !== identityId || note.kind !== kind));
  window.dispatchEvent(new Event(PERSONAL_NOTE_TIMER_EVENT));
  await kvRemoveClaims(noteTimerClaimPrefix(id)).catch(() => {});
}
