import { kvGet, kvRemove, kvSet, kvSetAsync, registerKvMigration } from "./kv-db";

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
};

function readNotes(): PersonalNote[] {
  const current = kvGet(PERSONAL_NOTES_KEY);
  if (current === null) return [];
  const parsed: unknown = JSON.parse(current);
  if (!Array.isArray(parsed)) throw new Error("无法读取手记数据");
  return parsed;
}

export function loadPersonalNotes(identityId: string | null, kind: PersonalNoteKind): PersonalNote[] {
  return readNotes()
    .filter(note => note && note.identityId === identityId && note.kind === kind)
    .sort((a, b) => kind === "diary"
      ? b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt)
      : b.updatedAt.localeCompare(a.updatedAt));
}

let pendingWrite: Promise<void> = Promise.resolve();

function updateNotes(update: (notes: PersonalNote[]) => PersonalNote[]): Promise<void> {
  const write = pendingWrite.then(async () => {
    const previous = kvGet(PERSONAL_NOTES_KEY);
    const next = JSON.stringify(update(readNotes()));
    try {
      await kvSetAsync(PERSONAL_NOTES_KEY, next);
    } catch (error) {
      if (kvGet(PERSONAL_NOTES_KEY) === next) {
        if (previous === null) kvRemove(PERSONAL_NOTES_KEY);
        else kvSet(PERSONAL_NOTES_KEY, previous);
      }
      throw error;
    }
  });
  pendingWrite = write.catch(() => {});
  return write;
}

export async function savePersonalNote(note: Omit<PersonalNote, "updatedAt">): Promise<void> {
  if (!note.title.trim() && !note.body.trim()) throw new Error("请填写标题或正文");
  if (note.kind === "diary" && !/^\d{4}-\d{2}-\d{2}$/.test(note.date)) throw new Error("请选择日记日期");
  return updateNotes(notes => {
    const index = notes.findIndex(item => item?.id === note.id);
    const saved = { ...note, title: note.title.trim(), updatedAt: new Date().toISOString() };
    if (index < 0) return [...notes, saved];
    if (notes[index].identityId !== note.identityId || notes[index].kind !== note.kind) throw new Error("无法更新这条手记");
    notes[index] = saved;
    return notes;
  });
}

export async function deletePersonalNote(id: string, identityId: string | null, kind: PersonalNoteKind): Promise<void> {
  await updateNotes(notes => notes.filter(note => note?.id !== id || note.identityId !== identityId || note.kind !== kind));
}
