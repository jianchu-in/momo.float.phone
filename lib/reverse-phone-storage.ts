import { loadChatScope, resolveChatScopeUserIdentity } from "./chat-scope-storage";
import { kvGet, kvKeysWithPrefix, kvUpdatePersisted, registerDynamicPrefix } from "./kv-db";
import { importShortMemories, persistShortMemoryChanges } from "./short-term-memory-records";
import { REVERSE_APPS, type BrowserEntry, type ReverseEvent, type ReverseOverride, type ReversePermissions, type ReverseScope, type ReverseSession, type ReverseSettings } from "./reverse-phone-types";

export const REVERSE_PREFIX = "ai_phone_reverse_v1:";
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
function normalizeSettings(raw: string | null): ReverseSettings {
  const defaults = defaultReversePermissions(), data = readReverseJson<Partial<ReverseSettings>>(raw, {});
  return { unified: { modes: { ...defaults.modes, ...data.unified?.modes }, chat: { ...defaults.chat, ...data.unified?.chat },
    shopping: { ...defaults.shopping, ...data.unified?.shopping }, browser: { ...defaults.browser, ...data.unified?.browser } }, characters: data.characters ?? {}, showTouch: data.showTouch !== false };
}
export function loadReverseSettings(scope = reverseScope()): ReverseSettings { return normalizeSettings(kvGet(settingsKey(scope))); }
export function resolveReversePermissions(characterId: string, scope = reverseScope()): ReversePermissions {
  const settings = loadReverseSettings(scope), override = settings.characters[characterId] ?? {};
  return { modes: { ...settings.unified.modes, ...override.modes }, chat: { ...settings.unified.chat, ...override.chat },
    shopping: { ...settings.unified.shopping, ...override.shopping }, browser: { ...settings.unified.browser, ...override.browser } };
}
export async function updateReverseSettings(scope: ReverseScope, update: (settings: ReverseSettings) => ReverseSettings) {
  assertReverseScope(scope);
  await kvUpdatePersisted(settingsKey(scope), raw => JSON.stringify(update(normalizeSettings(raw))));
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
export function loadReverseSession(id: string) { return readReverseJson<ReverseSession | null>(kvGet(sessionKey(id)), null); }
export function loadReverseSessions(scope = reverseScope()) {
  return kvKeysWithPrefix(REVERSE_PREFIX + "session:").map(key => readReverseJson<ReverseSession | null>(kvGet(key), null))
    .filter((item): item is ReverseSession => !!item && item.scope.key === scope.key).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function saveReverseSession(session: ReverseSession) {
  await kvUpdatePersisted(sessionKey(session.id), () => JSON.stringify({ ...session, updatedAt: new Date().toISOString() }));
}
export function reverseMemoryText(session: ReverseSession) {
  return `[查手机] 我查看了${session.scope.userName}的手机。\n` + session.events.map(event => event.text).join("\n");
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
export function createReverseSession(character: { id: string; name: string }, scope = reverseScope()): ReverseSession {
  const now = new Date().toISOString();
  return { id: reverseId(), characterId: character.id, characterName: character.name, scope, status: "paused", createdAt: now, updatedAt: now,
    tasks: [{ id: reverseId(), kind: "desktop", state: "pending" }], events: [] };
}
export function allowedReverseApps(characterId: string, scope: ReverseScope) { const permissions = resolveReversePermissions(characterId, scope); return (Object.keys(REVERSE_APPS) as Array<keyof typeof REVERSE_APPS>).filter(app => permissions.modes[app] !== "hidden"); }
