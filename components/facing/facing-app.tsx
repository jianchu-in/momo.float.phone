"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, History, Images, Map as MapIcon, Plus, ScanLine, Settings2, UserRound, X } from "lucide-react";
import { FacingMapApp } from "./facing-map-app";
import { FacingMapSettings } from "./facing-map-panels";
import { mapActivitySnapshot, mapPlacePath, saveMapArrival, type FacingAtlas, type MapTrip } from "@/lib/facing-map-storage";
import { loadCharacters } from "@/lib/character-storage";
import type { Character } from "@/lib/character-types";
import { createFacingMeeting, deleteFacingAssets, FACING_DEFAULT_APPEARANCE, FACING_DEFAULT_SCENE, FACING_PARTS, FACING_REPLY_LENGTHS, FACING_VISUAL_INTERVAL, facingAssetLocation, facingParticipantIds, facingId, facingMeetingPosition, facingScenePosition, groupFacingScenes, loadFacingAssets, loadFacingMeeting, loadFacingMeetings, loadFacingSettings, resolveFacingScene, saveFacingMeetingStart, saveFacingSettings,
  type FacingAsset, type FacingCharacterSettings, type FacingHotspot, type FacingMeeting } from "@/lib/facing-storage";
import { resolveUserIdentity } from "@/lib/settings-storage";
import { saveFacingParticipants } from "@/lib/facing-storage";
import { unlockAudioPlayback } from "@/lib/tts-service";
import { FacingAssets } from "./facing-assets";
import { FacingRoom } from "./facing-room";
import { FacingStage } from "./facing-stage";
import { ShownImage } from "@/components/ui/shown-image";
import { storeShownImage } from "@/lib/shown-image";
import { useFacingSceneGeneration } from "./use-facing-scene-generation";
import { useFacingViewportInset } from "./use-facing-viewport-inset";

type Page = "home" | "room" | "settings" | "assets" | "hotspots" | "records" | "record" | "map" | "map-settings";
type Sheet = "characters" | "new" | null;

function Header({ title, onBack, children }: { title: string; onBack: () => void; children?: ReactNode }) {
  return <header className="facing-header">
    <button type="button" className="facing-back" onClick={onBack} aria-label="返回"><ChevronLeft size={22} /></button>
    <h1>{title}</h1>{children}
  </header>;
}

function FacingSheet({ title, children, close, center }: { title: string; children: ReactNode; close: () => void; center?: boolean }) {
  return <div className={`facing-overlay${center ? " facing-overlay-center" : ""}`} onClick={close}>
    <section className="facing-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={event => event.stopPropagation()}>
      <header><h2>{title}</h2><button type="button" className="facing-icon" onClick={close} aria-label="关闭"><X size={18} /></button></header>
      {children}
    </section>
  </div>;
}

const PART_POSITION: Record<string, [number, number]> = {
  脸颊: [56, 27], 眼睛: [49, 22], 嘴巴: [50, 30], 耳朵: [63, 26], 胸口: [51, 49], 小腹: [51, 67], 手: [69, 72],
};

function HotspotEditor({ character, portrait, scene, points: initialPoints, onBack, onSave }: {
  character: Character; portrait?: FacingAsset; scene?: FacingAsset; points: FacingHotspot[];
  onBack: () => void; onSave: (points: FacingHotspot[]) => Promise<void>;
}) {
  const [points, setPoints] = useState(initialPoints);
  const [id, setId] = useState(initialPoints[0]?.id);
  const [test, setTest] = useState(false);
  const [hit, setHit] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const point = points.find(item => item.id === id);
  function update(id: string, patch: Partial<FacingHotspot>) {
    setPoints(current => current.map(item => item.id === id ? { ...item, ...patch } : item));
  }
  function add(label: string) {
    const [x, y] = PART_POSITION[label] ?? [50, 42];
    const point = { id: facingId(), label, x, y, width: 21, height: 13 };
    setPoints(current => [...current, point]);
    setId(point.id);
  }
  async function save() {
    if (busy) return;
    setBusy(true);
    setError("");
    try { await onSave(points.filter(item => item.label.trim()).map(item => ({ ...item, label: item.label.trim() }))); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "点位保存失败。"); }
    finally { setBusy(false); }
  }
  return <>
    <Header title="虚拟体感" onBack={onBack} />
    <main className="facing-scroll facing-form">
      <div className="facing-hotspot-preview">
        <FacingStage portrait={portrait} scene={scene} fallback={character.avatar} name={character.name} points={points}
          editing={!test} activePoint={id} onPoint={item => test ? setHit(item.label) : setId(item.id)}
          onPointMove={(target, x, y) => update(target, { x, y })} />
      </div>
      <div className="facing-row"><span>{test ? hit ? `已触碰${hit}` : "轻点人物检查位置" : "拖动区域调整位置"}</span>
        <button className="facing-small" type="button" aria-pressed={test} onClick={() => { setTest(!test); setHit(""); }}>{test ? "返回编辑" : "试触碰"}</button></div>
      {!test && <>
        <div className="facing-choices">{FACING_PARTS.map(label => <button type="button" key={label} className="facing-small" onClick={() => add(label)}>{label}</button>)}
          <button type="button" className="facing-small" onClick={() => add("自定义")}><Plus size={15} />自定义</button></div>
        {!!points.length && <label>触碰区域<select value={id ?? ""} onChange={event => setId(event.target.value)}>
          {points.map(item => <option key={item.id} value={item.id}>{item.label || "未命名区域"}</option>)}
        </select></label>}
        {point && <div className="facing-point-controls">
          <label>部位名称<input value={point.label} maxLength={20} onChange={event => update(point.id, { label: event.target.value })} /></label>
          <div className="facing-pair">
            <label>横向大小<input type="range" min={8} max={45} value={point.width} onChange={event => update(point.id, { width: +event.target.value })} /></label>
            <label>纵向大小<input type="range" min={5} max={35} value={point.height} onChange={event => update(point.id, { height: +event.target.value })} /></label>
          </div>
          <button type="button" className="facing-soft" onClick={() => { const left = points.filter(item => item.id !== point.id); setPoints(left); setId(left[0]?.id); }}>移除此区域</button>
        </div>}
      </>}
      {error && <p className="facing-error" role="alert">{error}</p>}
      <button type="button" className="facing-primary" disabled={busy} onClick={() => void save()}>保存点位</button>
    </main>
  </>;
}

const RECORD_TABS = { main: "主线", branch: "分线", independent: "独立" } as const;

function MeetingTranscript({ record, character, onBack, onContinue, onFork }: {
  record: FacingMeeting; character: Character; onBack: () => void; onContinue: () => void; onFork: () => void;
}) {
  return <>
    <Header title="记录详情" onBack={onBack} />
    <main className="facing-scroll">
      <h2 className="facing-record-title">{record.title || facingMeetingPosition(record).sceneName}</h2>
      <div className="facing-record-meta">{character.name} · {RECORD_TABS[record.type]} · {new Date(record.updatedAt).toLocaleString("zh-CN")}</div>
      <ol className="facing-turns">
        {record.turns.map(turn => <li key={turn.id} data-role={turn.role}>
          <small>{turn.role === "assistant" ? turn.speakerName ?? character.name : "你"} · {turn.sceneName}{turn.kind === "voice" ? " · 语音转写" : ""}</small>
          {turn.imageRef && <ShownImage mediaRef={turn.imageRef} className="facing-message-photo" />}
          {!!turn.touches?.length && <p className="facing-action">{turn.touches.map(part => `（触碰了${part}）`).join(" ")}</p>}
          {turn.action && <p className="facing-action">{turn.action}</p>}
          {turn.text && <p>{turn.kind === "touch" ? `触碰了${turn.text}` : turn.text}</p>}
          {turn.reactionName && <em>{turn.reactionName}</em>}
        </li>)}
      </ol>
    </main>
    <footer className="facing-record-footer">
      <button type="button" className="facing-primary" onClick={onContinue}>继续见面</button>
      {record.type !== "independent" && <button type="button" className="facing-soft" onClick={onFork}>从这里开分线</button>}
    </footer>
  </>;
}

export function FacingApp({ onClose }: { onClose: () => void }) {
  const [characters] = useState(loadCharacters);
  const [preferences, setPreferences] = useState(loadFacingSettings);
  const character = characters.find(item => item.id === preferences.characterId);
  const participantIds = [...new Set([preferences.characterId, ...(preferences.participantIds ?? [])])].filter((id): id is string => !!id && characters.some(item => item.id === id));
  const [castDraft, setCastDraft] = useState(participantIds);
  const castNames = participantIds.map(id => characters.find(item => item.id === id)!.name).join("、");
  const [page, setPage] = useState<Page>("home");
  const [mapOrigin, setMapOrigin] = useState<"home" | "room">("home");
  const [mapSettingsOrigin, setMapSettingsOrigin] = useState<"map" | "settings">("settings");
  const appRef = useRef<HTMLDivElement>(null);
  const pageInset = useFacingViewportInset(appRef, page !== "room" && page !== "home");
  const [sheet, setSheet] = useState<Sheet>(() => !character && characters.length ? "characters" : null);
  const [settingOrigin, setSettingOrigin] = useState<"home" | "room">("home");
  const [assetOrigin, setAssetOrigin] = useState<"settings" | "home">("settings");
  const [meeting, setMeeting] = useState<FacingMeeting>();
  const [draftMeeting, setDraftMeeting] = useState<FacingMeeting>();
  const [openingScene, setOpeningScene] = useState(FACING_DEFAULT_SCENE);
  const [starting, setStarting] = useState(false);
  const [record, setRecord] = useState<FacingMeeting>();
  const [recordType, setRecordType] = useState<FacingMeeting["type"]>("main");
  const [error, setError] = useState("");
  const [savingReference, setSavingReference] = useState(false);
  const [assets, setAssets] = useState(() => character ? loadFacingAssets(character.id) : []);
  const autoVisual = useFacingSceneGeneration(
    updated => setMeeting(current => current?.id === updated.id ? updated : current),
    (characterId, updated) => { if (loadFacingSettings().characterId === characterId) setAssets(updated); },
  );
  const current = character ? preferences.characters[character.id] ?? {} : {};
  const identityId = character ? resolveUserIdentity(character.id, "facing")?.id ?? null : null;
  const groups = groupFacingScenes(assets, current.portraitId);
  const castKey = [...participantIds].sort().join("|");
  const meetings = useMemo(() => character ? loadFacingMeetings(character.id, identityId, true)
    .filter(item => [...facingParticipantIds(item)].sort().join("|") === castKey) : [], [character, identityId, meeting, castKey]);
  const latest = meetings[0];
  const initialAsset = assets.find(item => item.id === (current.useScene === false ? current.fullPortraitId ?? current.portraitId : current.sceneId ?? current.portraitId));
  const initialGroup = groups.find(group => group.name === (initialAsset ? facingAssetLocation(initialAsset) : undefined)) ?? groups[0];
  const homeScene = resolveFacingScene(latest ? facingMeetingPosition(latest) : facingScenePosition(initialGroup), groups, assets);
  const room = meeting ? resolveFacingScene(facingMeetingPosition(meeting), groups, assets) : homeScene;
  const hotspotScene = settingOrigin === "room" ? room : homeScene;
  const records = page === "records" ? meetings.filter(item => item.type === recordType) : [];

  async function selectCharacters() {
    setError("");
    try { setPreferences(await saveFacingParticipants(castDraft)); setAssets(loadFacingAssets(castDraft[0])); setSheet(null); }
    catch { setError("角色选择保存失败。"); }
  }

  function openCharacters() { setCastDraft(participantIds); setSheet("characters"); }

  async function changeSetting(patch: Partial<FacingCharacterSettings>) {
    if (character) setPreferences(await saveFacingSettings(character.id, patch));
  }

  function commitSetting(patch: Partial<FacingCharacterSettings>) {
    setError("");
    void changeSetting(patch).catch(() => setError("设置保存失败。"));
  }

  function openAssets(from: "settings" | "home") {
    setAssetOrigin(from);
    setPage("assets");
  }

  function openRoom(item: FacingMeeting) {
    unlockAudioPlayback();
    setMeeting(loadFacingMeeting(item.id) ?? item);
    if (item.characterId !== character?.id) {
      setAssets(loadFacingAssets(item.characterId));
      setPreferences(current => ({ ...current, characterId: item.characterId,
        participantIds: [item.characterId, ...facingParticipantIds(item).filter(id => id !== item.characterId)] }));
      void saveFacingParticipants([item.characterId, ...facingParticipantIds(item).filter(id => id !== item.characterId)])
        .then(setPreferences).catch(() => setError("见面角色选择保存失败。"));
    }
    setRecordType(item.type);
    setPage("room");
  }

  function prepareMeeting(type: FacingMeeting["type"], parent?: FacingMeeting) {
    if (!character) return;
    setError("");
    const preferred = parent ? facingMeetingPosition(parent).sceneName : homeScene.position.sceneName;
    setOpeningScene(groups.some(group => group.name === preferred) ? preferred : initialGroup?.name ?? FACING_DEFAULT_SCENE);
    const draft = createFacingMeeting(character.id, identityId, type, parent);
    setDraftMeeting(parent ? draft : { ...draft, participantIds });
    setSheet("new");
  }

  async function startMeeting() {
    if (!draftMeeting || starting) return;
    setStarting(true);
    setError("");
    try {
      const position = facingScenePosition(groups.find(group => group.name === openingScene));
      const started = await saveFacingMeetingStart(draftMeeting, position);
      setPreferences(await saveFacingParticipants(facingParticipantIds(started)));
      setSheet(null);
      openRoom(started);
    } catch {
      setError("新对话保存失败，请重试。");
    } finally { setStarting(false); }
  }

  function openSettings(origin: "home" | "room") {
    setSettingOrigin(origin);
    setPage("settings");
  }

  async function arriveFromMap(atlas: FacingAtlas, trip: MapTrip, visitId: string) {
    const activity = mapActivitySnapshot(atlas)?.entries.filter(entry => entry.placeId === trip.placeId) ?? [];
    const participants = Array.from(new Set([...trip.characterIds, ...(trip.targetCharacterId ? [trip.targetCharacterId] : activity.map(entry => entry.characterId))]));
    const primaryId = trip.characterIds[0] ?? trip.targetCharacterId ?? participants[0] ?? character?.id;
    if (!primaryId) throw new Error("请先选择一位角色。");
    const target = characters.find(item => item.id === primaryId);
    if (!target) throw new Error("这位角色已被移除。");
    const targetAssets = loadFacingAssets(primaryId);
    const destination = mapPlacePath(atlas, trip.placeId);
    const group = groupFacingScenes(targetAssets).find(item => item.name === destination || item.name === destination.split(" · ").at(-1));
    const scene = { ...facingScenePosition(group), sceneName: destination };
    const identity = resolveUserIdentity(character?.id, "facing")?.id ?? null;
    const started = await saveMapArrival(atlas.id, trip, visitId, primaryId, identity, participants, scene, meeting);
    setPreferences(await saveFacingParticipants([primaryId, ...participants.filter(id => id !== primaryId)]));
    setAssets(targetAssets);
    openRoom(started);
  }

  return <div ref={appRef} className="facing-app" style={{ paddingBottom: pageInset }}>
    {page === "home" && <>
      <Header title="面对面" onBack={onClose}>
        {character && <button type="button" className="facing-icon" onClick={() => { setMapOrigin("home"); setPage("map"); }} aria-label="世界地图"><MapIcon size={20} /></button>}
        {character && <button type="button" className="facing-icon" onClick={() => openSettings("home")} aria-label="设置"><Settings2 size={20} /></button>}
      </Header>
      {character ? <>
        <div className="facing-home-stage">
          <FacingStage portrait={homeScene.portrait} scene={homeScene.backdrop} name={character.name} fallback={character.avatar}>
            <div className="facing-home-label"><small>{homeScene.position.sceneName}{participantIds.length > 1 ? ` · ${participantIds.length}人见面` : ""}</small><strong>{castNames}</strong></div>
          </FacingStage>
        </div>
        <footer className="facing-home-actions">
          {latest && <button type="button" className="facing-primary" onClick={() => openRoom(latest)}>继续上次对话<ChevronRight size={18} /></button>}
          <button type="button" className={latest ? "facing-soft" : "facing-primary"} onClick={() => prepareMeeting("main")}><Plus size={17} />开启新对话</button>
          <div className="facing-pair">
            <button type="button" className="facing-link" onClick={openCharacters}><UserRound size={17} />选择见面角色{participantIds.length > 1 ? ` · ${participantIds.length}人` : ""}</button>
            <button type="button" className="facing-link" onClick={() => { setRecordType(latest?.type ?? "main"); setPage("records"); }}><History size={16} />见面记录</button>
          </div>
        </footer>
      </> : <div className="facing-home-empty"><UserRound size={48} strokeWidth={1.2} />
        <button type="button" className="facing-primary" onClick={openCharacters} disabled={!characters.length}>选择角色</button>
        {!characters.length && <p>先在角色库里添加一位角色。</p>}
      </div>}
    </>}
    {page === "room" && character && meeting && <FacingRoom key={meeting.id} character={character} meeting={meeting} settings={current}
      portrait={room.portrait} scene={room.backdrop} position={room.position} scenes={groups} onMeeting={setMeeting}
      autoAsset={assets.find(asset => asset.id === meeting.visual?.assetId)} autoProgress={autoVisual.progress[meeting.id]}
      onCompleted={completed => autoVisual.check(completed, character)}
      onMap={() => { setMapOrigin("room"); setPage("map"); }}
      onSettings={() => openSettings("room")} onEnd={() => { setMeeting(undefined); setPage("home"); }}
      onVoice={value => commitSetting({ voice: value })} onSpeechInput={value => commitSetting({ speechInput: value })} />}
    {page === "settings" && character && <>
      <Header title="角色设置" onBack={() => setPage(settingOrigin)} />
      <main className="facing-scroll facing-form">
        <h2 className="facing-record-title">{character.name}</h2>
        <div className="facing-list">
          <button type="button" onClick={() => { setMapSettingsOrigin("settings"); setPage("map-settings"); }}><MapIcon size={18} /><span>地图设置</span><ChevronRight size={17} /></button>
          <button type="button" onClick={() => openAssets("settings")}><Images size={18} /><span>场景素材</span><ChevronRight size={17} /></button>
          <button type="button" onClick={() => setPage("hotspots")}><ScanLine size={18} /><span>虚拟体感</span><ChevronRight size={17} /></button>
        </div>
        <section className="facing-form" key={character.id} aria-label="随剧情换场">
          <h2 className="facing-record-title">随剧情换场</h2>
          <div className="facing-list facing-settings-list facing-auto-settings">
            <label>自动检查并补图<input type="checkbox" role="switch" checked={current.autoVisual?.enabled === true}
              onChange={event => commitSetting({ autoVisual: { enabled: event.target.checked } })} /></label>
            <label>生图前跳过 NSFW 场景<input type="checkbox" role="switch" checked={current.autoVisual?.skipNsfw === true}
              onChange={event => commitSetting({ autoVisual: { skipNsfw: event.target.checked } })} /></label>
            <label>画面检查间隔（轮）<input type="number" min={1} step={1} inputMode="numeric" defaultValue={current.autoVisual?.interval ?? FACING_VISUAL_INTERVAL}
              onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }}
              onBlur={event => {
                const previous = current.autoVisual?.interval ?? FACING_VISUAL_INTERVAL;
                const value = event.currentTarget.valueAsNumber;
                if (!Number.isSafeInteger(value) || value < 1) event.currentTarget.value = String(previous);
                else if (value !== previous) commitSetting({ autoVisual: { interval: value } });
              }} /></label>
            <label>人物参考图<select value={current.autoVisual?.referenceSource ?? "character"}
              onChange={event => commitSetting({ autoVisual: { referenceSource: event.target.value as "character" | "avatar" | "upload" } })}>
              <option value="character">角色参考图（没有时用头像）</option><option value="avatar">角色头像</option><option value="upload">自选图片</option>
            </select></label>
            {current.autoVisual?.referenceSource === "upload" && <div className="facing-auto-reference">
              {current.autoVisual.referenceMediaRef && <ShownImage mediaRef={current.autoVisual.referenceMediaRef} />}
              <label>{savingReference ? "保存中…" : "选择参考图"}<input type="file" accept="image/*" disabled={savingReference}
                onChange={event => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  if (!file) return;
                  setSavingReference(true);
                  setError("");
                  void storeShownImage(file).then(referenceMediaRef => changeSetting({ autoVisual: { referenceMediaRef } }))
                    .catch(() => setError("人物参考图保存失败，请重新选择。"))
                    .finally(() => setSavingReference(false));
                }} /></label>
            </div>}
          </div>
          <p className="facing-auto-help">先匹配现成素材。需要补图时，会将场景基础图和人物参考图一起交给生图模型。</p>
        </section>
        <div className="facing-list facing-settings-list">
          <label>回复长度<select value={current.length ?? "short"} onChange={event => commitSetting({ length: event.target.value as FacingCharacterSettings["length"] })}>
            {Object.entries(FACING_REPLY_LENGTHS).map(([value, option]) => <option key={value} value={value}>{option.label} · 约 {option.characters} 字</option>)}
          </select></label>
          <label>角色语音<input type="checkbox" role="switch" checked={current.voice !== false} onChange={event => commitSetting({ voice: event.target.checked })} /></label>
          <label>启用触碰区域<input type="checkbox" role="switch" checked={current.touch !== false} onChange={event => commitSetting({ touch: event.target.checked })} /></label>
          <label>触碰方式<select value={current.touchMode ?? "instant"} onChange={event => commitSetting({ touchMode: event.target.value as FacingCharacterSettings["touchMode"] })}>
            <option value="instant">点击后立即回应</option><option value="collect">随消息发送</option><option value="double">单击记录，双击回应</option>
          </select></label>
          <label>读写角色记忆<input type="checkbox" role="switch" checked={current.memory !== false} onChange={event => commitSetting({ memory: event.target.checked })} /></label>
        </div>
        <section className="facing-form" aria-label="对话外观">
          <h2 className="facing-record-title">对话外观</h2>
          <div className="facing-list facing-settings-list facing-appearance">
            <label>气泡颜色<input type="color" value={current.appearance?.bubbleColor ?? FACING_DEFAULT_APPEARANCE.bubbleColor}
              onChange={event => commitSetting({ appearance: { ...current.appearance, bubbleColor: event.target.value } })} /></label>
            <label>气泡不透明度<input type="range" min={15} max={100} defaultValue={current.appearance?.opacity ?? FACING_DEFAULT_APPEARANCE.opacity}
              onPointerUp={event => commitSetting({ appearance: { ...current.appearance, opacity: Number(event.currentTarget.value) } })}
              onKeyUp={event => commitSetting({ appearance: { ...current.appearance, opacity: Number(event.currentTarget.value) } })} /></label>
            <label>文字颜色<input type="color" value={current.appearance?.textColor ?? FACING_DEFAULT_APPEARANCE.textColor}
              onChange={event => commitSetting({ appearance: { ...current.appearance, textColor: event.target.value } })} /></label>
            <label>文字大小<select value={current.appearance?.textSize ?? FACING_DEFAULT_APPEARANCE.textSize}
              onChange={event => commitSetting({ appearance: { ...current.appearance, textSize: Number(event.target.value) } })}>
              {[12, 13, 14, 15, 16, 17, 18, 20, 22].map(size => <option key={size} value={size}>{size} px</option>)}
            </select></label>
          </div>
        </section>
      </main>
    </>}
    {(page === "map" || (page === "map-settings" && mapSettingsOrigin === "map")) && character &&
      <div style={{ display: page === "map" ? "flex" : "none", flex: 1, minHeight: 0 }}>
        <FacingMapApp character={character} characters={characters} currentMeeting={meeting}
          onBack={() => setPage(mapOrigin)} onSettings={() => { setMapSettingsOrigin("map"); setPage("map-settings"); }} onArrive={arriveFromMap} />
      </div>}
    {page === "map-settings" && <FacingMapSettings onBack={() => setPage(mapSettingsOrigin)} />}
    {page === "assets" && character && <FacingAssets key={character.id} character={character} assets={assets} groups={groups}
      onBack={() => setPage(assetOrigin)} onChange={() => setAssets(loadFacingAssets(character.id))}
      onDelete={async assetIds => {
        await deleteFacingAssets(character.id, assetIds);
        setAssets(loadFacingAssets(character.id));
        setPreferences(loadFacingSettings());
      }} />}
    {page === "hotspots" && character && <HotspotEditor character={character} portrait={hotspotScene.portrait} scene={hotspotScene.backdrop}
      points={current.hotspots?.[hotspotScene.portrait?.id ?? "avatar"] ?? []} onBack={() => setPage("settings")} onSave={async points => {
        await changeSetting({ hotspots: { ...current.hotspots, [hotspotScene.portrait?.id ?? "avatar"]: points } });
        setPage("settings");
      }} />}
    {page === "records" && character && <>
      <Header title="见面记录" onBack={() => setPage("home")} />
      <main className="facing-scroll facing-form">
        <div className="facing-segments" role="group" aria-label="记录分类">
          {Object.entries(RECORD_TABS).map(([key, label]) => <button type="button" key={key} aria-pressed={recordType === key}
            onClick={() => setRecordType(key as FacingMeeting["type"])}>{label}</button>)}
        </div>
        <div className="facing-row"><span>{character.name}</span><button type="button" className="facing-small" onClick={() => prepareMeeting("independent")}><Plus size={16} />新开独立见面</button></div>
        <div className="facing-list">
          {records.map(item =>
            <button type="button" key={item.id} onClick={() => { setRecord(item); setPage("record"); }}>
              <span className="facing-record-row"><strong>{item.title || facingMeetingPosition(item).sceneName}</strong>
                <small>{facingMeetingPosition(item).sceneName} · {new Date(item.updatedAt).toLocaleDateString("zh-CN")}</small></span><ChevronRight size={17} />
            </button>)}
          {!records.length &&
            <p className="facing-empty">暂无{RECORD_TABS[recordType]}见面记录</p>}
        </div>
      </main>
    </>}
    {page === "record" && character && record && <MeetingTranscript record={record} character={character}
      onBack={() => setPage("records")} onContinue={() => openRoom(record)} onFork={() => prepareMeeting("branch", record)} />}
    {sheet === "characters" && <FacingSheet title="选择见面角色 · 可多选" close={() => setSheet(null)}>
      <p className="facing-hint">选择一位进入单人见面，选择多位进入多人见面，各自保留见面记录。</p>
      <div className="facing-list">
        {characters.map(item => <button type="button" key={item.id} aria-pressed={castDraft.includes(item.id)} onClick={() => setCastDraft(current => current.includes(item.id) ? current.filter(id => id !== item.id) : [...current, item.id])}>
          <span className="facing-character-avatar">{item.avatar ? <img alt="" src={item.avatar} /> : <UserRound size={19} />}</span>
          <span>{item.name}</span>{castDraft.includes(item.id) && <small>已选择 ✓</small>}
        </button>)}
      </div>
      <button type="button" className="facing-primary" disabled={!castDraft.length} onClick={() => void selectCharacters()}>确认选择 · {castDraft.length}人</button>
    </FacingSheet>}
    {sheet === "new" && <FacingSheet title="选择开场场景" close={() => { if (!starting) setSheet(null); }}>
      <label className="facing-opening-scene">开场场景<select value={openingScene} disabled={starting} onChange={event => setOpeningScene(event.target.value)}>
        {groups.length ? groups.map(group => <option key={group.name}>{group.name}</option>) : <option>{FACING_DEFAULT_SCENE}</option>}
      </select></label>
      <fieldset className="facing-cast-picker" disabled={starting || !!draftMeeting?.parentId}>
        <legend>在场角色 · 可多选</legend>
        <p className="facing-hint">多人时随机选取部分角色接话，顺序随机。按各自绑定的语音依次播放。</p>
        <div className="facing-choices">{characters.map(item => {
          const checked = !!draftMeeting && facingParticipantIds(draftMeeting).includes(item.id);
          return <button type="button" key={item.id} className="facing-small" aria-pressed={checked}
            disabled={item.id === character?.id} onClick={() => setDraftMeeting(current => current ? { ...current,
              participantIds: checked ? facingParticipantIds(current).filter(id => id !== item.id) : [...facingParticipantIds(current), item.id] } : current)}>
            {item.name}{checked ? " ✓" : ""}</button>;
        })}</div>
      </fieldset>
      <button type="button" className="facing-primary" disabled={starting} onClick={() => void startMeeting()}>开始对话</button>
    </FacingSheet>}
    {error && <p className="facing-global-error" role="alert">{error}</p>}
  </div>;
}
