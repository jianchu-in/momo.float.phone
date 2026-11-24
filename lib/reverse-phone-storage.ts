import { loadChatScope, resolveChatScopeUserIdentity } from "./chat-scope-storage";
import { kvGet, kvSet, kvKeysWithPrefix, kvUpdatePersisted, kvUpdatePersistedEntries, registerDynamicPrefix } from "./kv-db";
import { importShortMemories, persistShortMemoryChanges } from "./short-term-memory-records";
import { REVERSE_APPS, type BrowserEntry, type ReverseEvent, type ReverseOverride, type ReversePermissions, type ReverseScope, type ReverseSession, type ReverseSettings } from "./reverse-phone-types";

export const REVERSE_PREFIX = "ai_phone_reverse_v1:";
export const REVERSE_RECORDS_UPDATED_EVENT = "reverse-phone-records-updated";
function announceRecords() { if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(REVERSE_RECORDS_UPDATED_EVENT)); }
registerDynamicPrefix(REVERSE_PREFIX);
export const reverseId = () => crypto.randomUUID();
export function readReverseJson<T>(raw: string | null, fallback: T): T { try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } }
export function reverseScope(): ReverseScope {
  const scope = loadChatScope(), user = resolveChatScopeUserIdentity();
  return { ...scope, identityId: user?.id ?? null, userName: user?.name || "用户", userAvatar: user?.avatarUrl,
    key: JSON.stringify([scope.chatAccountId, user?.id ?? null]) };
}
export function assertReverseScope(scope: ReverseScope) { if (reverseScope().key !== scope.key) throw new Error("当前用户或聊天账号已切换，已停止本次查岗。"); }
export function defaultReversePermissions(): ReversePermissions {
  return { modes: { chat: "open", shopping: "open", browser: "open", reading: "open" },
    chat: { targets: null, reply: true, remark: true, assets: true, balance: true }, shopping: { cart: true, orders: true }, browser: { history: true, bookmarks: true } };
}
function settingsKey(scope: ReverseScope) { return REVERSE_PREFIX + "settings:" + scope.key; }
const recordObject = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
function normalizeOverride(input: unknown): ReverseOverride {
  const value = recordObject(input), result: ReverseOverride = {};
  for (const section of ["chat", "shopping", "browser", "modes", "automation"] as const) {
    const source = recordObject(value[section]), target: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(source)) {
      if (section === "modes") { if (key in REVERSE_APPS && ["open", "locked", "hidden"].includes(String(entry))) target[key] = entry; }
      else if (section === "chat" && key === "targets") { if (entry === null) target[key] = null; else if (Array.isArray(entry)) target[key] = [...new Set(entry.filter((id): id is string => typeof id === "string"))]; }
      else if (section === "automation") {
        if (["invitation", "proactive", "stealth"].includes(key) && typeof entry === "boolean") target[key] = entry;
        if (key === "timing" && ["fixed", "random"].includes(String(entry))) target[key] = entry;
        if (["intervalHours", "minGapHours", "weeklyLimit"].includes(key) && typeof entry === "number" && Number.isFinite(entry)) target[key] = entry;
        if (["startsAt", "endsAt"].includes(key) && typeof entry === "string" && (!entry || Number.isFinite(Date.parse(entry)))) target[key] = entry;
      } else {
        const keys = section === "chat" ? ["reply", "remark", "assets", "balance"] : section === "shopping" ? ["cart", "orders"] : ["history", "bookmarks"];
        if (keys.includes(key) && typeof entry === "boolean") target[key] = entry;
      }
    }
    if (Object.keys(target).length) Object.assign(result, { [section]: target });
  }
  return result;
}
function normalizeSettings(raw: string | null): ReverseSettings {
  const defaults = defaultReversePermissions(), data = recordObject(readReverseJson<unknown>(raw, {}));
  const unified = normalizeOverride(data.unified);
  const characters = Object.fromEntries(Object.entries(recordObject(data.characters)).map(([id, value]) => [id, normalizeOverride(value)]));
  const automation = normalizeOverride({automation: data.automation}).automation;
  return {automation: automation as ReverseSettings["automation"], unified: {modes: {...defaults.modes, ...unified.modes}, chat: {...defaults.chat, ...unified.chat}, shopping: {...defaults.shopping, ...unified.shopping}, browser: {...defaults.browser, ...unified.browser}}, characters, showTouch: data.showTouch !== false};
}
export function loadReverseSettings(scope = reverseScope()): ReverseSettings { return normalizeSettings(kvGet(settingsKey(scope))); }
export function resolveReversePermissions(characterId: string, scope = reverseScope()): ReversePermissions {
  const settings = loadReverseSettings(scope), override = settings.characters[characterId] ?? {};
  return { modes: { ...settings.unified.modes, ...override.modes }, chat: { ...settings.unified.chat, ...override.chat },
    shopping: { ...settings.unified.shopping, ...override.shopping }, browser: { ...settings.unified.browser, ...override.browser } };
}
export async function updateReverseSettings(scope: ReverseScope, update: (settings: ReverseSettings) => ReverseSettings) {
  assertReverseScope(scope);
  await kvUpdatePersisted(settingsKey(scope), raw => {
    const next=update(normalizeSettings(raw));
    for(const options of [next.automation,...Object.values(next.characters).map(value=>({...next.automation,...value.automation}))])if(options?.startsAt&&options.endsAt&&Date.parse(options.endsAt)<=Date.parse(options.startsAt))throw new Error("授权结束时间必须晚于开始时间。");
    return JSON.stringify(next);
  });
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("reverse-phone-settings-updated"));
}
export function inheritReverseOption(override: ReverseOverride, section: keyof ReverseOverride, key: string, value: unknown): ReverseOverride {
  const next = structuredClone(override) as Record<string, Record<string, unknown>>;
  next[section] ??= {};
  if (value === undefined) delete next[section][key]; else next[section][key] = value;
  return next as ReverseOverride;
}
const browserKey = (scope: ReverseScope) => REVERSE_PREFIX + "browser:" + scope.key;
export function loadUserBrowser(scope = reverseScope()): BrowserEntry[] { return readReverseJson<BrowserEntry[]>(kvGet(browserKey(scope)), []); }
export async function saveUserBrowserEntry(scope: ReverseScope, entry: BrowserEntry, remove = false) {
  assertReverseScope(scope);
  await kvUpdatePersisted(browserKey(scope), raw => JSON.stringify([
    ...(remove ? [] : [{ ...entry, title: entry.title.trim(), updatedAt: new Date().toISOString() }]),
    ...readReverseJson<BrowserEntry[]>(raw, []).filter(item => item.id !== entry.id),
  ]));
}
const sessionKey = (id: string) => REVERSE_PREFIX + "session:" + id;
const replayKey = (id: string) => REVERSE_PREFIX + "replay:" + id;
const summaryKey = (id: string) => REVERSE_PREFIX + "summary:" + id;
type ReplayFrames = NonNullable<ReverseSession["replay"]>;
function withoutReplay(session: ReverseSession): ReverseSession {
  const {replay, ...record} = session;
  return {...record, replayFrameCount: replay?.length ?? record.replayFrameCount ?? 0};
}
function sessionSummary(session: ReverseSession): ReverseSession {
  const {characterAvatar: _avatar, ...record} = withoutReplay(session);
  const {userAvatar: _userAvatar, ...scope} = record.scope;
  return {...record, scope};
}
export function loadReverseSession(id: string, includeReplay = true): ReverseSession | null {
  const record = readReverseJson<ReverseSession | null>(kvGet(sessionKey(id)), null);
  if (!record) return null;
  if (!includeReplay) {
    const count = readReverseJson<ReverseSession | null>(kvGet(summaryKey(id)), null)?.replayFrameCount;
    return {...withoutReplay(record), ...(count !== undefined ? {replayFrameCount: count} : {})};
  }
  const frames = readReverseJson<ReplayFrames>(kvGet(replayKey(id)), []);
  return frames.length ? {...record, replay: frames, replayFrameCount: frames.length} : record;
}
export function loadReverseSessions(scope = reverseScope()) {
  return kvKeysWithPrefix(REVERSE_PREFIX + "session:").map(key => loadReverseSession(key.slice((REVERSE_PREFIX + "session:").length)))
    .filter((item): item is ReverseSession => !!item && item.scope.key === scope.key).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
/** List views never materialize replay HTML or embedded image data. Legacy records are indexed one at a time. */
export function loadReverseSessionSummaries(scope = reverseScope()): ReverseSession[] {
  const result: ReverseSession[] = [];
  for (const key of kvKeysWithPrefix(REVERSE_PREFIX + "session:")) {
    const id = key.slice((REVERSE_PREFIX + "session:").length);
    let summary = readReverseJson<ReverseSession | null>(kvGet(summaryKey(id)), null);
    if (!summary) {
      const record = loadReverseSession(id, false);
      if (!record) continue;
      summary = sessionSummary(record);
      try { kvSet(summaryKey(id), JSON.stringify(summary)); } catch { /* The original record remains readable. */ }
    }
    if (summary.scope.key === scope.key) result.push(summary);
  }
  return result.sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function saveReverseSession(session: ReverseSession) {
  let saved = withoutReplay({...session, updatedAt: new Date().toISOString()}), legacy: ReplayFrames = [];
  await kvUpdatePersistedEntries({
    [sessionKey(session.id)]: raw => {
      const previous = readReverseJson<ReverseSession | null>(raw, null);
      legacy = previous?.replay?.length ? previous.replay : session.replay ?? [];
      saved = {...saved, replayFrameCount: previous?.replayFrameCount ?? legacy.length};
      return JSON.stringify(saved);
    },
    [replayKey(session.id)]: raw => {
      // Pausing/opening settings only updates metadata; do not parse or copy large replay arrays.
      if (raw && !legacy.length) return raw;
      const stored = readReverseJson<ReplayFrames>(raw, []), frames = stored.length >= legacy.length ? stored : legacy;
      saved.replayFrameCount = frames.length;
      return JSON.stringify(frames);
    },
    [summaryKey(session.id)]: raw => {
      const previous = readReverseJson<ReverseSession | null>(raw, null);
      saved.replayFrameCount = Math.max(saved.replayFrameCount ?? 0, previous?.replayFrameCount ?? 0);
      return JSON.stringify(sessionSummary(saved));
    },
  });
  announceRecords();
}
// Receipts are stored separately: an in-flight runner cannot overwrite a viewed flag.
type ReverseReceipt = { viewed?: string; notified?: string };
const receiptKey = (record: ReverseSession) => REVERSE_PREFIX + "receipt:" + record.scope.key + ":" + record.id;
export const reverseRecordRevision = (record: ReverseSession) => JSON.stringify([record.events.length, record.events.at(-1)?.id ?? "", record.status]);
export function isReverseRecordUnread(record: ReverseSession) {
  return !!(record.events.length || (record.replayFrameCount || record.replay?.length)) && readReverseJson<ReverseReceipt>(kvGet(receiptKey(record)), {}).viewed !== reverseRecordRevision(record);
}
export function pendingStealthNotices(records: ReverseSession[], characterId: string) {
  return records.filter(record => record.characterId === characterId && record.origin === "stealth" && record.status !== "running" && isReverseRecordUnread(record)
    && readReverseJson<ReverseReceipt>(kvGet(receiptKey(record)), {}).notified !== reverseRecordRevision(record));
}
export async function markReverseRecordViewed(record: ReverseSession) {
  assertReverseScope(record.scope);
  const revision = reverseRecordRevision(record);
  await kvUpdatePersisted(receiptKey(record), raw => {
    assertReverseScope(record.scope);
    return JSON.stringify({ ...readReverseJson<ReverseReceipt>(raw, {}), viewed: revision, notified: revision });
  });
  announceRecords();
}
export async function acknowledgeReverseNotices(records: ReverseSession[]) {
  const updates = Object.fromEntries(records.map(record => [receiptKey(record), (raw: string | null) => {
    assertReverseScope(record.scope);
    return JSON.stringify({ ...readReverseJson<ReverseReceipt>(raw, {}), notified: reverseRecordRevision(record) });
  }]));
  if (records.length) { await kvUpdatePersistedEntries(updates); announceRecords(); }
}
export async function appendReverseReplay(id: string, frame: NonNullable<ReverseSession["replay"]>[number]) {
  let record: ReverseSession | null = null, legacy: ReplayFrames = [];
  await kvUpdatePersistedEntries({
    [sessionKey(id)]: raw => {
      const previous = readReverseJson<ReverseSession | null>(raw, null);
      if (!previous) return raw ?? "null";
      legacy = previous.replay ?? []; record = withoutReplay(previous);
      return JSON.stringify(record);
    },
    [replayKey(id)]: raw => {
      if (!record) return raw ?? "[]";
      const stored = readReverseJson<ReplayFrames>(raw, []), frames = stored.length >= legacy.length ? stored : legacy;
      const previous = frames.at(-1), lastHtml = frames.slice().reverse().find(entry => entry.html)?.html;
      if (previous && lastHtml === frame.html && previous.speech === frame.speech && previous.loading === frame.loading && JSON.stringify(previous.touch) === JSON.stringify(frame.touch)) { record.replayFrameCount = frames.length; return JSON.stringify(frames); }
      record.replayFrameCount = frames.length + 1;
      return JSON.stringify([...frames, {...frame, html: lastHtml === frame.html ? "" : frame.html}]);
    },
    [summaryKey(id)]: raw => record ? JSON.stringify(sessionSummary(record)) : raw ?? "null",
  });
}
export function reverseMemoryText(session: ReverseSession) {
  return `[查手机] ${session.origin === "stealth" ? `我在事先授权范围内自主偷偷查看了${session.scope.userName}的手机，这次不是用户主动邀请。` : session.origin === "dialogue" ? `我通过与${session.scope.userName}的对话进入并查看了手机。` : `我受邀查看了${session.scope.userName}的手机。`}\n` + session.events.map(event => event.text).join("\n");
}
let memoryWrites = Promise.resolve();
export function rememberReverseSession(session: ReverseSession) {
  const write = memoryWrites.then(async () => {
    if (!session.events.length) return;
    importShortMemories(session.characterId, [{ id: `reverse_phone_${session.id}`, sourceApp: "checkphone", sourceDetail: "checkphone", sourceLabel: "查手机",
      authorType: "character", memoryScope: "short", timestamp: session.createdAt, chatAccountId: session.scope.chatAccountId ?? undefined,
      userNickname: session.scope.userName, content: reverseMemoryText(session) }]);
    await persistShortMemoryChanges(session.characterId);
  });
  memoryWrites = write.catch(() => {}); return write;
}
export function appendReverseEvent(session: ReverseSession, kind: ReverseEvent["kind"], text: string, id = reverseId()): ReverseSession {
  if (session.events.some(event => event.id === id)) return session;
  return { ...session, events: [...session.events, { id, kind, text, at: new Date().toISOString() }] };
}
export function createReverseSession(character: { id: string; name: string; avatar?: string|null }, scope = reverseScope()): ReverseSession {
  const now = new Date().toISOString();
  return { id: reverseId(), characterId: character.id, characterName: character.name, characterAvatar: character.avatar??undefined, scope, status: "paused", createdAt: now, updatedAt: now,
    tasks: [{ id: reverseId(), kind: "desktop", state: "pending" }], events: [] };
}
export function allowedReverseApps(characterId: string, scope: ReverseScope) { const permissions = resolveReversePermissions(characterId, scope); return (Object.keys(REVERSE_APPS) as Array<keyof typeof REVERSE_APPS>).filter(app => permissions.modes[app] !== "hidden"); }
