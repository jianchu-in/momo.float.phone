import { kvGet, kvKeysWithPrefix, kvUpdatePersisted } from "./kv-db";
import type { MascotPageContext } from "./mascot-context";
import type { DiscussionTurn } from "./roleplay-discussion";

const KEY_PREFIX = "ai_phone_roleplay_discussion_conversation_v1:";
export const DISCUSSION_HISTORY_UPDATED = "roleplay-discussion-history-updated";

const SCENE_FIELDS = ["sessionId", "characterId", "entryId", "phoneAppId", "postIds", "chatAccountId", "userName", "signature"] as const;

export type DiscussionMessage = DiscussionTurn & {
  id: string;
  speaker: string;
  replyTo?: string;
};

type DiscussionSelection = {
  characterId: string;
  characterName: string;
  presetId: string;
};

export type DiscussionConversation = DiscussionSelection & {
  id: string;
  context: MascotPageContext;
  updatedAt: number;
  messages: DiscussionMessage[];
};

export function discussionId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function createDiscussionConversation(context: MascotPageContext, character?: { id: string; name: string }): DiscussionConversation {
  const fields: MascotPageContext["fields"] = {};
  for (const key of SCENE_FIELDS) {
    if (context.fields[key] !== undefined) fields[key] = context.fields[key];
  }
  return {
    id: discussionId(),
    context: { ...context, fields },
    characterId: character?.id ?? "",
    characterName: character?.name ?? "",
    presetId: "model",
    updatedAt: Date.now(),
    messages: [],
  };
}

function parseConversation(raw: string | null): DiscussionConversation | null {
  try {
    const value = JSON.parse(raw ?? "null") as DiscussionConversation | null;
    return value && typeof value.id === "string" && value.context && Array.isArray(value.messages) ? value : null;
  } catch {
    return null;
  }
}

export function loadDiscussionConversations(): DiscussionConversation[] {
  return kvKeysWithPrefix(KEY_PREFIX)
    .map(key => parseConversation(kvGet(key)))
    .filter((item): item is DiscussionConversation => !!item?.messages.length)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function updateDiscussionConversation(
  conversation: DiscussionConversation,
  update: { selection?: Partial<DiscussionSelection>; message?: DiscussionMessage },
): Promise<DiscussionConversation> {
  let result = conversation;
  await kvUpdatePersisted(KEY_PREFIX + conversation.id, raw => {
    const current = parseConversation(raw) ?? conversation;
    const messages = [...current.messages];
    const message = update.message;
    if (message && !messages.some(item => item.id === message.id || (message.replyTo && item.replyTo === message.replyTo))) {
      const replyIndex = message.replyTo ? messages.findIndex(item => item.id === message.replyTo) : -1;
      if (replyIndex >= 0) messages.splice(replyIndex + 1, 0, message);
      else messages.push(message);
    }
    result = {
      ...current,
      ...update.selection,
      messages,
      updatedAt: message ? Date.now() : current.updatedAt,
    };
    return JSON.stringify(result);
  });
  window.dispatchEvent(new Event(DISCUSSION_HISTORY_UPDATED));
  return result;
}
