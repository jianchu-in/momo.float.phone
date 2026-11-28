import { kvGet, kvKeysWithPrefix, kvUpdatePersistedEntries } from "./kv-db";
import { FACING_MEETING_PREFIX, facingCompletedRounds, facingParticipantIds, loadFacingMeeting, type FacingMeeting } from "./facing-storage";
import { FACING_MAP_PREFIX, loadFacingAtlas, type FacingAtlas } from "./facing-map-storage";
import { announceMemorySourceDeletion, appendMemorySourceDeletions, memorySourceDeletionKey, type DeletedMemorySource } from "./memory-source-deletions";
import { loadMemoryEntries } from "./memory-storage";

function parse<T>(raw: string | null): T | undefined {
  try { return raw ? JSON.parse(raw) ?? undefined : undefined; } catch { return undefined; }
}

type Request = { meetingIds?: string[]; message?: { meetingId: string; turnIds: string[] };
  visit?: { atlasId: string; visitId: string; identityId: string | null } };

/** Source removal and durable memory invalidation commit together, before cross-database cleanup. */
async function deleteFacingContent(request: Request) {
  const meetings = kvKeysWithPrefix(FACING_MEETING_PREFIX).map(key => parse<FacingMeeting>(kvGet(key))).filter((item): item is FacingMeeting => !!item);
  const atlases = kvKeysWithPrefix(FACING_MAP_PREFIX).map(key => parse<FacingAtlas>(kvGet(key))).filter((item): item is FacingAtlas => !!item);
  const meetingIds = new Set(request.meetingIds ?? []);
  const eventIds = new Set<string>();
  for (const id of meetingIds) {
    const meeting = meetings.find(item => item.id === id);
    if (!meeting) throw new Error("部分见面记录不存在。");
    meeting.turns.forEach(turn => eventIds.add(turn.id));
  }
  if (request.message) {
    const meeting = meetings.find(item => item.id === request.message!.meetingId && !item.deletedAt);
    if (!meeting) throw new Error("见面记录已移除。");
    const requested = new Set(request.message.turnIds);
    meeting.turns.filter(turn => requested.has(turn.id)).forEach(turn => eventIds.add(turn.id));
  }
  if (request.visit) {
    const atlas = atlases.find(item => item.id === request.visit!.atlasId);
    if (!atlas) throw new Error("找不到这张地图。");
    const visit = atlas.visits.find(item => item.id === request.visit!.visitId);
    if (visit && visit.identityId !== request.visit.identityId) throw new Error("只能删除当前身份的出行记录。");
    if (!visit) return;
    eventIds.add(`${visit.id}:arrival`);
  }

  // A response generated directly from a deleted message must not retain that event as memory.
  // Keep its visible transcript; invalidate only its memory provenance and prompt projection.
  let grew = true;
  while (grew) {
    grew = false;
    for (const meeting of meetings) for (const turn of meeting.turns) {
      if (turn.replyTo && eventIds.has(turn.replyTo) && !eventIds.has(turn.id)) {
        eventIds.add(turn.id); grew = true;
      }
    }
  }

  const removedVisits = atlases.flatMap(atlas => atlas.visits
    .filter(visit => meetingIds.has(visit.meetingId) || eventIds.has(`${visit.id}:arrival`))
    .map(visit => ({ atlas, visit })));
  const arrivalIds = new Set(removedVisits.map(({ visit }) => `${visit.id}:arrival`));
  arrivalIds.forEach(id => eventIds.add(id));
  const sources = new Map<string, DeletedMemorySource[]>();
  const addSource = (characterId: string, source: DeletedMemorySource) => {
    if (!characterId) return;
    const entries = sources.get(characterId) ?? [];
    entries.push(source);
    sources.set(characterId, entries);
  };
  for (const meeting of meetings) {
    for (const turn of meeting.turns) {
      if (!eventIds.has(turn.id)) continue;
      for (const id of turn.participantIds ?? facingParticipantIds(meeting)) {
        addSource(id, { sourceApp: "facing", sessionId: meeting.id, id: turn.id });
      }
    }
  }
  // Older backups may retain a visit after its arrival message has already been removed.
  for (const { visit } of removedVisits) {
    if (meetings.some(meeting => meeting.turns.some(turn => turn.id === `${visit.id}:arrival`))) continue;
    const meeting = meetings.find(item => item.id === visit.meetingId);
    for (const id of new Set([...visit.characterIds, ...(meeting ? facingParticipantIds(meeting) : [])])) {
      addSource(id, { sourceApp: "facing", sessionId: visit.meetingId, id: `${visit.id}:arrival` });
    }
  }

  const now = new Date().toISOString();
  const updates: Record<string, (raw: string | null) => string> = {};
  for (const meeting of meetings) {
    const requested = meeting.id === request.message?.meetingId ? new Set(request.message.turnIds) : new Set<string>();
    const removing = new Set(meeting.turns.filter(turn => arrivalIds.has(turn.id) || requested.has(turn.id)).map(turn => turn.id));
    const clearArrival = meeting.mapContext?.arrival && eventIds.has(`${meeting.mapContext.arrival.visitId}:arrival`);
    if (!meetingIds.has(meeting.id) && !removing.size && !clearArrival) continue;
    updates[FACING_MEETING_PREFIX + meeting.id] = raw => {
      const current = parse<FacingMeeting>(raw);
      if (!current) throw new Error("见面记录已更新，请重新删除。");
      if (meetingIds.has(meeting.id)) {
        if (JSON.stringify(current) !== JSON.stringify(meeting)) throw new Error("见面记录有新消息，请重新确认删除。");
        return JSON.stringify({ ...current, deletedAt: current.deletedAt ?? now, updatedAt: now });
      }
      const turns = current.turns.filter(turn => !removing.has(turn.id))
        .map(turn => turn.replyTo && removing.has(turn.replyTo) ? { ...turn, replyTo: undefined } : turn);
      const last = turns.at(-1);
      const scene = last?.id === current.turns.at(-1)?.id ? current.scene
        : last ? { sceneName: last.sceneName, sceneId: last.sceneId, portraitId: last.portraitId } : current.scene;
      return JSON.stringify({ ...current, turns, scene, visual: undefined,
        castEvents: current.castEvents?.filter(event => !removing.has(event.turnId)),
        mapContext: current.mapContext && (current.mapContext.arrival && eventIds.has(`${current.mapContext.arrival.visitId}:arrival`)
          ? { ...current.mapContext, arrival: undefined } : current.mapContext),
        completedRounds: facingCompletedRounds(current), sceneRevision: (current.sceneRevision ?? 0) + 1, updatedAt: now });
    };
  }
  for (const atlas of atlases) {
    const ids = new Set(removedVisits.filter(item => item.atlas.id === atlas.id).map(item => item.visit.id));
    if (!ids.size) continue;
    updates[FACING_MAP_PREFIX + atlas.id] = raw => {
      const current = parse<FacingAtlas>(raw);
      if (!current) throw new Error("地图已移除，请重新打开。");
      return JSON.stringify({ ...current, visits: current.visits.filter(visit => !ids.has(visit.id)),
        deletedVisitIds: [...new Set([...(current.deletedVisitIds ?? []), ...ids])], updatedAt: now });
    };
  }
  for (const [characterId, entries] of sources) {
    updates[memorySourceDeletionKey(characterId)] = raw => appendMemorySourceDeletions(raw, entries);
  }
  if (!Object.keys(updates).length) return;
  await kvUpdatePersistedEntries(updates);
  announceMemorySourceDeletion([...sources.keys()]);
  // The readers also enforce the ledger and retry physical cleanup if this attempt is interrupted.
  await Promise.allSettled([...sources.keys()].map(loadMemoryEntries));
}

export async function deleteFacingMessages(meetingId: string, turnIds: string[]): Promise<FacingMeeting> {
  await deleteFacingContent({ message: { meetingId, turnIds } });
  const saved = loadFacingMeeting(meetingId);
  if (!saved) throw new Error("见面记录已移除。");
  return saved;
}

export async function deleteFacingMeetingsAndMemories(meetingIds: string[]) {
  await deleteFacingContent({ meetingIds: [...new Set(meetingIds)] });
}

export async function deleteMapVisitAndMemories(atlasId: string, visitId: string, identityId: string | null) {
  await deleteFacingContent({ visit: { atlasId, visitId, identityId } });
  const atlas = loadFacingAtlas(atlasId);
  if (!atlas) throw new Error("地图已移除。");
  return atlas;
}
