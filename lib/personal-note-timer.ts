import { loadCharacters } from "./character-storage";
import { createOrGetSession, hydrateChatStorage, pushChatMessage } from "./chat-storage";
import { kvClaim } from "./kv-db";
import { DEFAULT_NOTE_REACTION_PREMISE, generatePersonalNoteReaction, savePersonalNoteReaction } from "./personal-note-reactions";
import { loadPersistedPersonalNoteTimerSettings, noteTimerClaimPrefix } from "./personal-note-timer-settings";
import { loadPersistedPersonalNotes, type PersonalNote } from "./personal-notes-storage";
import { resolveUserIdentity } from "./settings-storage";

const attempted = new Set<string>();
let running = false;
let rerun = false;
let active: { note: PersonalNote; characterId: string; controller: AbortController } | null = null;

async function eligible(note: PersonalNote, characterId: string) {
  const settings = await loadPersistedPersonalNoteTimerSettings();
  if (!settings.enabled || settings.epoch !== note.autoPeek?.epoch ||
      !settings.characterIds.includes(characterId) || !loadCharacters().some(item => item.id === characterId) ||
      note.identityId !== (resolveUserIdentity()?.id ?? null)) return undefined;
  const latest = (await loadPersistedPersonalNotes()).find(item => item.id === note.id &&
    item.identityId === note.identityId && item.autoPeek?.epoch === settings.epoch);
  return latest && { note: latest, settings };
}

export function cancelStalePersonalNoteReaction() {
  const current = active;
  if (!current) return;
  void eligible(current.note, current.characterId).then(note => {
    if (!note) current.controller.abort();
  }).catch(() => {});
}

function notify(message: string) {
  window.dispatchEvent(new CustomEvent("global-notice", { detail: message }));
}

export async function runPersonalNoteTimerCheck(): Promise<void> {
  if (running) {
    rerun = true;
    return;
  }
  running = true;
  try {
    const settings = await loadPersistedPersonalNoteTimerSettings();
    if (!settings.enabled) return;
    const identityId = resolveUserIdentity()?.id ?? null;
    const notes = (await loadPersistedPersonalNotes()).filter(note =>
      note.identityId === identityId && note.autoPeek?.epoch === settings.epoch && note.autoPeek.dueAt <= Date.now());
    for (const note of notes) {
      for (const characterId of note.autoPeek?.characterIds ?? []) {
        const claimKey = `${noteTimerClaimPrefix(note.id)}${characterId}`;
        if (attempted.has(claimKey) || !settings.characterIds.includes(characterId)) continue;
        const latest = await eligible(note, characterId);
        if (!latest) continue;
        // Persist the attempt before calling the API, even if the browser closes mid-request.
        const claimed = await kvClaim(claimKey);
        attempted.add(claimKey);
        if (!claimed) continue;
        const controller = new AbortController();
        active = { note: latest.note, characterId, controller };
        try {
          const ready = await eligible(latest.note, characterId);
          if (!ready || controller.signal.aborted) continue;
          const prepareMessage = ready.settings.remember && ready.settings.sendMessage;
          const reaction = await generatePersonalNoteReaction(identityId, [note.id], characterId,
            DEFAULT_NOTE_REACTION_PREMISE, controller.signal, () => {}, { note: ready.note, prepareMessage });
          const current = await eligible(latest.note, characterId);
          if (!current || controller.signal.aborted) continue;
          const remember = current.settings.remember;
          if (!remember || !current.settings.sendMessage) delete reaction.proactiveMessage;
          await savePersonalNoteReaction(reaction, remember);
          if (!reaction.proactiveMessage) continue;
          await hydrateChatStorage();
          const afterSave = await eligible(latest.note, characterId);
          if (!afterSave?.settings.remember || !afterSave.settings.sendMessage || controller.signal.aborted) continue;
          const session = createOrGetSession(characterId, null);
          const message = pushChatMessage({
            role: "assistant", sessionId: session.id,
            senderName: reaction.characterName, content: reaction.proactiveMessage,
          });
          window.dispatchEvent(new CustomEvent("chat-messages-updated", { detail: { sessionId: session.id, messages: [message] } }));
        } catch {
          if (!controller.signal.aborted) notify("手记的定时偷看未完成，可到手记手动生成。");
        } finally {
          active = null;
        }
      }
    }
  } catch {
    // A later timer tick can retry reading storage.
  } finally {
    running = false;
    if (rerun) {
      rerun = false;
      void runPersonalNoteTimerCheck();
    }
  }
}
