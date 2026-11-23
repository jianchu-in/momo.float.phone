import { kvGet, kvUpdatePersisted, kvUpdatePersistedEntries } from "./kv-db";
import { assertReverseScope, createReverseSession, loadReverseSession, loadReverseSettings, readReverseJson, REVERSE_PREFIX } from "./reverse-phone-storage";
import type { ReverseAutomation, ReverseScope, ReverseSession } from "./reverse-phone-types";

export const REVERSE_SETTINGS_EVENT = "reverse-phone-settings-updated";
export const WEEK = 7 * 24 * 3600000;
export const DEFAULT_REVERSE_AUTOMATION: ReverseAutomation = { invitation: false, proactive: false, stealth: false, timing: "random", intervalHours: 24, minGapHours: 6, weeklyLimit: 3, startsAt: "", endsAt: "" };
const number = (v: unknown, fallback: number, min: number, max: number) => typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
export function normalizeReverseAutomation(value?: Partial<ReverseAutomation>): ReverseAutomation {
  return { invitation: value?.invitation === true, proactive: value?.proactive === true, stealth: value?.stealth === true,
    timing: value?.timing === "fixed" ? "fixed" : "random", intervalHours: number(value?.intervalHours, 24, 1, 720),
    minGapHours: number(value?.minGapHours, 6, 1, 168), weeklyLimit: Math.floor(number(value?.weeklyLimit, 3, 1, 30)),
    startsAt: value?.startsAt && Number.isFinite(Date.parse(value.startsAt)) ? value.startsAt : "",
    endsAt: value?.endsAt && Number.isFinite(Date.parse(value.endsAt)) ? value.endsAt : "" };
}
export function resolveReverseAutomation(characterId: string, scope: ReverseScope): ReverseAutomation {
  const settings = loadReverseSettings(scope);
  return normalizeReverseAutomation({ ...settings.automation, ...settings.characters[characterId]?.automation });
}
type Plan = { signature: string; nextAt: number; started: number[] };
const planKey = (scope: ReverseScope, id: string) => REVERSE_PREFIX + "plan:" + scope.key + ":" + id;
export function nextReverseTime(options: ReverseAutomation, now: number, started: number[], random = Math.random): number {
  const recent = started.filter(t => t > now - WEEK).sort((a,b) => a-b);
  const last = recent.at(-1);
  const gap = (options.timing === "fixed" ? Math.max(options.intervalHours, options.minGapHours) : options.minGapHours) * 3600000;
  let earliest = Math.max(now, Date.parse(options.startsAt) || now, last === undefined ? now + gap : last + gap);
  if (recent.length >= options.weeklyLimit) earliest = Math.max(earliest, recent[recent.length-options.weeklyLimit] + WEEK + 1);
  return earliest + (options.timing === "random" ? Math.floor(Math.max(0, Math.min(1, random())) * Math.max(3600000, WEEK / options.weeklyLimit)) : 0);
}
export function reverseAuthorizationActive(options: ReverseAutomation, now: number) {
  return options.stealth && (!options.startsAt || now >= Date.parse(options.startsAt)) && (!options.endsAt || now < Date.parse(options.endsAt));
}
/** One persisted transaction reserves a random slot, consumes its quota and creates the actual record. */
export async function claimStealthReverse(character: { id: string; name: string }, scope: ReverseScope, now = Date.now()): Promise<ReverseSession | null> {
  assertReverseScope(scope);
  const options = resolveReverseAutomation(character.id, scope), signature = JSON.stringify([options.timing, options.intervalHours, options.minGapHours, options.weeklyLimit, options.startsAt, options.endsAt]);
  if (!reverseAuthorizationActive(options, now)) return null;
  const key = planKey(scope, character.id);
  await kvUpdatePersisted(key, raw => {
    const old = readReverseJson<Plan | null>(raw, null);
    if (old?.signature === signature) return raw!;
    const started = old?.started ?? [];
    return JSON.stringify({ signature, started, nextAt: nextReverseTime(options, now, started) });
  });
  const planned = readReverseJson<Plan | null>(kvGet(key), null);
  if (!planned || now < planned.nextAt) return null;
  let claimed: ReverseSession | null = null;
  const candidate = { ...createReverseSession(character, scope), id: "stealth_" + encodeURIComponent(scope.key) + "_" + character.id + "_" + planned.nextAt };
  await kvUpdatePersistedEntries({
    [key]: raw => {
      const old = readReverseJson<Plan | null>(raw, null);
      if (!old || old.signature !== signature || old.nextAt !== planned.nextAt || now < old.nextAt) return raw ?? "null";
      const started = old.started.filter(t => t > now-WEEK).sort((a,b)=>a-b);
      if (started.length >= options.weeklyLimit || (started.length && now-started[started.length-1] < options.minGapHours*3600000)) {
        return JSON.stringify({ signature, started, nextAt: nextReverseTime(options, now, started) });
      }
      claimed = { ...candidate, createdAt: new Date(now).toISOString(), accepted: true, origin: "stealth" };
      return JSON.stringify({ signature, started: [...started, now], nextAt: nextReverseTime(options, now, [...started, now]) });
    },
    [REVERSE_PREFIX + "session:" + candidate.id]: raw => claimed ? JSON.stringify(claimed) : raw ?? "null",
  });
  if (claimed) return loadReverseSession(candidate.id);
  return null;
}

/** A lease shared by visible and hidden runners prevents two tabs/controllers using the phone together. */
export async function acquireReverseLease(scope: ReverseScope, sessionId: string, token: string, release = false) {
  let acquired = false;
  await kvUpdatePersisted(REVERSE_PREFIX + "lease:" + scope.key, raw => {
    const old = readReverseJson<{token:string;sessionId:string;until:number} | null>(raw, null);
    if (release) return old?.token === token ? "null" : raw ?? "null";
    if (old && old.token !== token && old.until > Date.now()) return raw!;
    acquired = true;
    return JSON.stringify({ token, sessionId, until: Date.now()+120000 });
  });
  return acquired;
}
export function reversePhoneBusy(scope: ReverseScope) {
  const lease = readReverseJson<{until:number} | null>(kvGet(REVERSE_PREFIX + "lease:" + scope.key), null);
  return !!lease && lease.until > Date.now();
}
