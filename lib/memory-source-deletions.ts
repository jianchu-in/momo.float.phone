import { kvGet, kvUpdatePersisted, registerDynamicPrefix } from "./kv-db";
import { getNativeTimelineEntryKey } from "./native-timeline-key";
import type { MemoryEntry } from "./memory-types";
import type { NativeTimelineEntry } from "./short-term-assembler";

export const MEMORY_SOURCE_DELETIONS_PREFIX = "ai_phone_memory_source_deletions_v1:";
registerDynamicPrefix(MEMORY_SOURCE_DELETIONS_PREFIX);

export type DeletedMemorySource = Pick<NativeTimelineEntry, "sourceApp" | "sessionId" | "id">;
type Deletions = { sources: DeletedMemorySource[]; memoryIds: string[] };
const cache = new Map<string, { raw: string | null; value: Deletions; eventKeys: Set<string> }>();

function parse(raw: string | null): Deletions {
  try {
    const value = JSON.parse(raw ?? "null");
    return { sources: Array.isArray(value?.sources) ? value.sources : [], memoryIds: Array.isArray(value?.memoryIds) ? value.memoryIds : [] };
  } catch { return { sources: [], memoryIds: [] }; }
}

export function memorySourceDeletionKey(characterId: string) {
  return MEMORY_SOURCE_DELETIONS_PREFIX + characterId;
}

export const memorySourceEventKey = (source: Pick<NativeTimelineEntry, "sourceApp" | "id">) => JSON.stringify([source.sourceApp, source.id]);

function read(characterId: string) {
  const raw = kvGet(memorySourceDeletionKey(characterId));
  let saved = cache.get(characterId);
  if (!saved || saved.raw !== raw) {
    const value = parse(raw);
    saved = { raw, value, eventKeys: new Set(value.sources.map(memorySourceEventKey)) };
    if (cache.size > 40) cache.delete(cache.keys().next().value!);
    cache.set(characterId, saved);
  }
  return saved;
}

/** Used inside the same KV transaction as deleting the original messages or visits. */
export function appendMemorySourceDeletions(raw: string | null, sources: DeletedMemorySource[]) {
  const previous = parse(raw);
  const merged = new Map(previous.sources.map(source => [getNativeTimelineEntryKey(source as NativeTimelineEntry), source]));
  for (const source of sources) merged.set(getNativeTimelineEntryKey(source as NativeTimelineEntry), source);
  return JSON.stringify({ ...previous, sources: [...merged.values()] });
}

export function isNativeMemorySourceDeleted(characterId: string, entry: Pick<NativeTimelineEntry, "sourceApp" | "id">) {
  // Forks/merges retain turn IDs: a copied event must not restore a deleted memory.
  return read(characterId).eventKeys.has(memorySourceEventKey(entry));
}

const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

/** Exact provenance for new summaries, session provenance for older summaries. No text guessing. */
export function deletedSourceMemoryIds(characterId: string, entries: MemoryEntry[]) {
  const state = read(characterId);
  const deleted = state.value;
  const ids = new Set(deleted.memoryIds);
  if (!deleted.sources.length && !ids.size) return ids;
  const keys = new Set(deleted.sources.map(source => getNativeTimelineEntryKey(source as NativeTimelineEntry)));
  const sessions = new Set(deleted.sources.map(source => source.sessionId).filter(Boolean));
  const messages = new Set(deleted.sources.map(source => source.id));
  for (const entry of entries) {
    const sourceKeys = strings(entry.metadata?.sourceEntryKeys);
    const exact = sourceKeys.some(key => keys.has(key)) || strings(entry.metadata?.sourceEventKeys).some(key => state.eventKeys.has(key));
    const legacy = !sourceKeys.length && (strings(entry.metadata?.sourceSessionIds).some(id => sessions.has(id))
      || entry.sourceMessageIds?.some(id => messages.has(id)));
    if (exact || legacy) ids.add(entry.id);
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const entry of entries) {
      if (!ids.has(entry.id) && strings(entry.metadata?.sourceMemoryIds).some(id => ids.has(id))) {
        ids.add(entry.id); grew = true;
      }
    }
  }
  return ids;
}

export async function rememberDeletedDerivedMemories(characterId: string, ids: string[]) {
  if (!ids.length) return;
  await kvUpdatePersisted(memorySourceDeletionKey(characterId), raw => {
    const previous = parse(raw);
    return JSON.stringify({ ...previous, memoryIds: [...new Set([...previous.memoryIds, ...ids])] });
  });
}

export function announceMemorySourceDeletion(characterIds: string[]) {
  if (typeof window === "undefined") return;
  for (const characterId of new Set(characterIds)) {
    window.dispatchEvent(new CustomEvent("short-term-memory-changed", { detail: { characterId } }));
  }
}
