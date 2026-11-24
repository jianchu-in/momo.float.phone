"use client";

import {FACING_REPLY_FORMATS,facingVisibleSegments} from "@/lib/facing-reply-format";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, History, Images, Map as MapIcon, Plus, Settings2, UserRound, X } from "lucide-react";
import { FacingMapApp } from "./facing-map-app";
import { FacingMapSettings } from "./facing-map-panels";
import { loadFacingAtlas, mapActivitySnapshot, mapPlacePath, saveMapArrival, type FacingAtlas, type MapTrip } from "@/lib/facing-map-storage";
import {bigMapPlace} from "@/lib/facing-place-life";
import {resolveFacingLocation,bindFacingLocation,facingLocationCandidates} from "@/lib/facing-location";
import {FacingAmbience,type FacingAmbienceControl} from "./facing-ambience";
import { loadCharacters } from "@/lib/character-storage";
import type { Character } from "@/lib/character-types";
import { createFacingMeeting, deleteFacingAssets, loadFacingUsableAssets, changeFacingScene, manageFacingMeetings, mergeFacingMeetings, FACING_SHARED_CHARACTER_ID, FACING_DEFAULT_APPEARANCE, FACING_DEFAULT_SCENE, FACING_REPLY_LENGTHS, FACING_VISUAL_INTERVAL, facingAssetLocation, facingParticipantIds, facingId, facingMeetingPosition, facingScenePosition, groupFacingScenes, loadFacingAssets, loadFacingMeeting, loadFacingMeetings, loadFacingSettings, resolveFacingScene, saveFacingMeetingStart, saveFacingSettings,
  facingCgDisplayRounds, loadFacingAssets as loadCgAssets, type FacingAsset, type FacingCharacterSettings, type FacingMeeting } from "@/lib/facing-storage";
import { sceneForMapPlace } from "@/lib/facing-map-scenes";
import { continueFacingInStory } from "@/lib/story-storage";
import { loadUserIdentities, resolveUserIdentity } from "@/lib/settings-storage";
import { saveFacingParticipants } from "@/lib/facing-storage";
import { unlockAudioPlayback } from "@/lib/tts-service";
import "@/styles/facing-life.css";
import { FacingProducts } from "./facing-life-panels";
import { FacingAssets } from "./facing-assets";
import { FacingRoom } from "./facing-room";
import { FacingStage } from "./facing-stage";
import { ShownImage } from "@/components/ui/shown-image";
import { storeShownImage } from "@/lib/shown-image";
import { useFacingSceneGeneration } from "./use-facing-scene-generation";
import { useFacingViewportInset } from "./use-facing-viewport-inset";

type Page = "home" | "room" | "settings" | "assets" | "records" | "record" | "map" | "map-settings" | "products" | "shared-assets";
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
          {facingVisibleSegments(turn).map((part,index)=><p key={index} className={part.type==="action"?"facing-action":undefined}>{turn.kind==="touch"&&part.type==="dialogue"?`触碰了${part.text}`:part.text}</p>)}
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

export function FacingApp({ onClose, initialMeetingId, onLaunchConsumed }: { onClose: () => void; initialMeetingId?:string|null; onLaunchConsumed?:()=>void }) {
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
  const [assetOrigin, setAssetOrigin] = useState<"settings" | "home" | "room">("settings");
  const [assetEditId,setAssetEditId]=useState<string>();
  const [assetOwnerId,setAssetOwnerId]=useState<string>();
  const [recordRevision,setRecordRevision]=useState(0), [recordSelection,setRecordSelection]=useState<string[]>([]),[recordName,setRecordName]=useState("");
  const [confirmRecordDelete,setConfirmRecordDelete]=useState(false),[removeMergedSources,setRemoveMergedSources]=useState(false),[recordBusy,setRecordBusy]=useState(false);
  const [meeting, setMeeting] = useState<FacingMeeting>();
  useEffect(()=>{
    if(page!=="room"||!meeting)return;
    const location=resolveFacingLocation(meeting);
    const next=location?{atlasId:location.atlas.id,placeId:location.place.id}:undefined;
    setAudioLocation(old=>old?.atlasId===next?.atlasId&&old?.placeId===next?.placeId?old:next);
    if(location&&(meeting.mapContext?.atlasId!==location.atlas.id||meeting.mapContext?.placeId!==location.place.id))void bindFacingLocation(meeting,next).then(saved=>setMeeting(current=>current?.id===saved.id?saved:current)).catch(()=>setError("地点关联保存失败。"));
  },[page,meeting?.id,meeting?.scene?.sceneName,meeting?.scene?.sceneId]);
  const roomDrafts=useRef(new Map<string,{text:string;photo?:File}>());
  const [ambience,setAmbience]=useState<FacingAmbienceControl>();
  const [audioLocation,setAudioLocation]=useState<{atlasId:string;placeId:string}>();
  const audioAtlas=useMemo(()=>audioLocation?loadFacingAtlas(audioLocation.atlasId):undefined,[audioLocation,page]);
  const audioPlace=audioAtlas?bigMapPlace(audioAtlas,audioLocation?.placeId):undefined;
  useEffect(()=>{if(page==="home"||page==="records"||page==="record")setAudioLocation(undefined);},[page]);
  const [draftMeeting, setDraftMeeting] = useState<FacingMeeting>();
  const [openingScene, setOpeningScene] = useState(FACING_DEFAULT_SCENE);
  const [starting, setStarting] = useState(false);
  const [record, setRecord] = useState<FacingMeeting>();
  const [recordType, setRecordType] = useState<FacingMeeting["type"]>("main");
  const [error, setError] = useState("");
  const [savingReference, setSavingReference] = useState(false);
  const [assets, setAssets] = useState(() => character ? loadFacingUsableAssets(character.id) : []);
  const autoVisual = useFacingSceneGeneration(
    updated => setMeeting(current => current?.id === updated.id ? updated : current),
    (characterId, updated) => { if (loadFacingSettings().characterId === characterId) setAssets(updated); },
  );
  const current = character ? preferences.characters[character.id] ?? {} : {};
  const identityId = character ? resolveUserIdentity(character.id, "facing")?.id ?? null : null;
  const groups = useMemo(()=>groupFacingScenes(assets, current.portraitId),[assets,current.portraitId]);
  const castKey = [...participantIds].sort().join("|");
  const meetings = useMemo(() => character ? loadFacingMeetings(character.id, identityId, true)
    .filter(item => [...facingParticipantIds(item)].sort().join("|") === castKey) : [], [character, identityId, page, castKey, recordRevision]);
  const latest = meetings[0];
  const initialAsset = assets.find(item => item.id === (current.useScene === false ? current.fullPortraitId ?? current.portraitId : current.sceneId ?? current.portraitId));
  const initialGroup = groups.find(group => group.name === (initialAsset ? facingAssetLocation(initialAsset) : undefined)) ?? groups[0];
  const homeScene = resolveFacingScene(latest ? facingMeetingPosition(latest) : facingScenePosition(initialGroup), groups, assets);
  const room = meeting ? resolveFacingScene(facingMeetingPosition(meeting), groups, assets) : homeScene;
  const records = page === "records" ? meetings.filter(item => item.type === recordType) : [];

  async function selectCharacters() {
    setError("");
    try { setPreferences(await saveFacingParticipants(castDraft)); setAssets(loadFacingUsableAssets(castDraft[0])); setSheet(null); }
    catch { setError("角色选择保存失败。"); }
  }

  function openCharacters() { setCastDraft(participantIds); setSheet("characters"); }

  async function changeSetting(patch: Partial<FacingCharacterSettings>) {
    if (character) {setPreferences(await saveFacingSettings(character.id, patch));setAssets(loadFacingUsableAssets(character.id));}
  }

  function commitSetting(patch: Partial<FacingCharacterSettings>) {
    setError("");
    void changeSetting(patch).catch(() => setError("设置保存失败。"));
  }

  function openAssets(from: "settings" | "home" | "room") {
    setAssetEditId(undefined);setAssetOwnerId(character?.id);
    setAssetOrigin(from);
    setPage("assets");
  }

  function openRoom(item: FacingMeeting) {
    unlockAudioPlayback();
    const location=resolveFacingLocation(item);
    setAudioLocation(location?{atlasId:location.atlas.id,placeId:location.place.id}:undefined);
    if(location&&(!item.mapContext||item.mapContext.placeId!==location.place.id))void bindFacingLocation(item,{atlasId:location.atlas.id,placeId:location.place.id}).then(saved=>setMeeting(current=>current?.id===saved.id?saved:current)).catch(()=>setError("地点关联保存失败，可在场景菜单重新选择。"));
    setMeeting(loadFacingMeeting(item.id) ?? item);
    if (item.characterId !== character?.id || [...facingParticipantIds(item)].sort().join("|")!==castKey) {
      setAssets(loadFacingUsableAssets(item.characterId));
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
    const targetAssets = loadFacingUsableAssets(primaryId);
    const destination = mapPlacePath(atlas, trip.placeId);
    const matched=sceneForMapPlace(atlas,trip.placeId,primaryId);
    const scene = { ...matched, sceneName: destination };
    const identity = resolveUserIdentity(character?.id, "facing")?.id ?? null;
    const started = await saveMapArrival(atlas.id, trip, visitId, primaryId, identity, participants, scene, meeting);
    setPreferences(await saveFacingParticipants([primaryId, ...participants.filter(id => id !== primaryId)]));
    setAssets(targetAssets);
    openRoom(started);
  }

  useEffect(()=>{if(!initialMeetingId)return;const saved=loadFacingMeeting(initialMeetingId);if(saved)openRoom(saved);else setError("原面对面记录已移除，可以从见面记录选择其他对话。");onLaunchConsumed?.();},[initialMeetingId]);
  return <div ref={appRef} className="facing-app" style={{ paddingBottom: pageInset }}>
    <FacingAmbience track={audioPlace?.ambience} location={audioPlace?.name} embedded={page==="room"} onControl={setAmbience}/>
    {page === "home" && <>
      <Header title="面对面" onBack={onClose}>
        {character && <button type="button" className="facing-icon" onClick={() => { setMapOrigin("home"); setPage("map"); }} aria-label="世界地图"><MapIcon size={20} /></button>}
        {character && <button type="button" className="facing-icon" onClick={() => openSettings("home")} aria-label="设置"><Settings2 size={20} /></button>}
      </Header>
      {character ? <>
        <div className="facing-home-stage">
          <FacingStage portrait={homeScene.portrait} scene={homeScene.backdrop} name={character.name} fallback={homeScene.backdrop ? undefined : character.avatar} hideBlank={!!homeScene.backdrop}>
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
      initialDraft={roomDrafts.current.get(meeting.id)?.text} initialPhoto={roomDrafts.current.get(meeting.id)?.photo} onDraft={(text,photo)=>roomDrafts.current.set(meeting.id,{text,photo})}
      portrait={room.portrait} scene={room.backdrop} position={room.position} scenes={groups} onMeeting={setMeeting} ambience={ambience} locationOptions={character?facingLocationCandidates(character.id):[]} onLocation={async location=>{const saved=await bindFacingLocation(meeting,location);setMeeting(saved);setAudioLocation(location);}}
      autoAsset={(meeting.visual??meeting.lastCg)?loadCgAssets((meeting.visual??meeting.lastCg)?.characterId??meeting.characterId).find(asset => asset.id === (meeting.visual??meeting.lastCg)?.assetId):undefined} autoProgress={autoVisual.progress[meeting.id]}
      onCompleted={completed => autoVisual.check(completed, character)} onRetryCg={()=>autoVisual.retry(meeting.id)}
      onMap={() => { setMapOrigin("room"); setPage("map"); }}
      onStory={async()=>{await continueFacingInStory(loadFacingMeeting(meeting.id)??meeting,loadUserIdentities().find(item=>item.id===meeting.identityId)??resolveUserIdentity(character.id,"facing"));window.dispatchEvent(new CustomEvent("open-app",{detail:{appId:"story"}}));}}
      onScene={async name=>{const group=groups.find(item=>item.name===name);if(group)setMeeting(await changeFacingScene(meeting.id,facingScenePosition(group)));}}
      onPortraitLayout={async (owner,id,layout)=>{const previous=loadFacingSettings().characters[owner];setPreferences(await saveFacingSettings(owner,{portraitLayouts:{...previous?.portraitLayouts,[id]:layout}}));}}
      onSettings={() => openSettings("room")} onEnd={() => { setMeeting(undefined); setPage("home"); }}
      onSpeechInput={value => commitSetting({ speechInput: value })} />}
    {page === "settings" && character && <>
      <Header title="角色设置" onBack={() => setPage(settingOrigin)} />
      <main className="facing-scroll facing-form">
        <h2 className="facing-record-title">{character.name}</h2>
        <div className="facing-list">
          <button type="button" onClick={() => { setMapSettingsOrigin("settings"); setPage("map-settings"); }}><MapIcon size={18} /><span>地图设置</span><ChevronRight size={17} /></button>
          <button type="button" onClick={() => openAssets("settings")}><Images size={18} /><span>场景素材</span><ChevronRight size={17} /></button>
          <button type="button" onClick={()=>{setAssetOrigin("settings");setAssetEditId(undefined);setPage("shared-assets");}}><Images size={18}/><span>通用场景素材</span><ChevronRight size={17}/></button>
          <button type="button" onClick={()=>setPage("products")}><Images size={18}/><span>生图成品 · 按场景分类</span><ChevronRight size={17}/></button>
        </div>
        <section className="facing-form" key={character.id} aria-label="生成 CG 图（新画面）">
          <h2 className="facing-record-title">生成 CG 图（新画面）</h2>
          <div className="facing-list facing-settings-list facing-auto-settings">
            <label>每 N 轮生成 CG 图<input type="checkbox" role="switch" checked={current.autoVisual?.enabled === true}
              onChange={event => commitSetting({ autoVisual: { enabled: event.target.checked } })} /></label>
            <label>生图前跳过 NSFW 场景<input type="checkbox" role="switch" checked={current.autoVisual?.skipNsfw === true}
              onChange={event => commitSetting({ autoVisual: { skipNsfw: event.target.checked } })} /></label>
            <label>生图间隔（轮）<input type="number" min={1} step={1} inputMode="numeric" defaultValue={current.autoVisual?.interval ?? FACING_VISUAL_INTERVAL}
              onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }}
              onBlur={event => {
                const previous = current.autoVisual?.interval ?? FACING_VISUAL_INTERVAL;
                const value = event.currentTarget.valueAsNumber;
                if (!Number.isSafeInteger(value) || value < 1) event.currentTarget.value = String(previous);
                else if (value !== previous) commitSetting({ autoVisual: { interval: value, displayRounds: Math.min(facingCgDisplayRounds(current.autoVisual), value - 1) } });
              }} /></label>
            <label>CG 自动展示轮数<input type="number" min={0} max={Math.max(0,(current.autoVisual?.interval??FACING_VISUAL_INTERVAL)-1)} step={1} key={`display:${current.autoVisual?.interval}:${current.autoVisual?.displayRounds}`} defaultValue={facingCgDisplayRounds(current.autoVisual)} onBlur={event=>{const value=event.currentTarget.valueAsNumber;const max=Math.max(0,(current.autoVisual?.interval??FACING_VISUAL_INTERVAL)-1);if(!Number.isSafeInteger(value)||value<0||value>max){event.currentTarget.value=String(facingCgDisplayRounds(current.autoVisual));return;}commitSetting({autoVisual:{displayRounds:value}});}}/></label>
            <p className="facing-auto-help">展示轮数必须小于生图间隔。0 表示仅手动查看；图片显示后开始计数，一次完整对话回复算一轮。</p>
            <label>CG 生图额外要求<textarea key={`cg-prompt:${character.id}`} defaultValue={current.autoVisual?.extraPrompt??""} placeholder="例如：用户第一视角、真实摄影、温馨光线、增强代入感……" onBlur={e=>commitSetting({autoVisual:{extraPrompt:e.target.value}})}/></label>
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
          <p className="facing-auto-help">普通情绪只切换所选立绘。达到轮次后直接生成一张新的完整画面，使用当前场景背景、人物参考图和本轮描述；不复用旧图。CG 按展示轮数自动恢复，也可用顶部双人按钮手动打开或关闭；换地点时恢复新场景。底下的背景和立绘照常随对话更新。</p>
        </section>
        <h2 className="facing-record-title">生成要求</h2>
        <div className="facing-list facing-settings-list">
          <label>生成格式<select aria-label="生成格式" value={current.replyFormat??"alternating"} onChange={e=>commitSetting({replyFormat:e.target.value as FacingCharacterSettings["replyFormat"]})}>{Object.entries(FACING_REPLY_FORMATS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
          <label>额外提示词<textarea key={`reply-prompt:${character.id}`} defaultValue={current.extraPrompt??""} placeholder="统一文风、人称、避免的套话等，每次生成回复时带入" onBlur={e=>commitSetting({extraPrompt:e.target.value})}/></label>
          <label>回复长度<select value={current.length ?? "short"} onChange={event => commitSetting({ length: event.target.value as FacingCharacterSettings["length"] })}>
            {Object.entries(FACING_REPLY_LENGTHS).map(([value, option]) => <option key={value} value={value}>{option.label} · 约 {option.characters} 字</option>)}
            <option value="custom">自定义字数</option>
          </select></label>
          {current.length === "custom" && <label>自定义回复字数<input aria-label="自定义回复字数" type="number" min={1} max={10000} step={1} defaultValue={current.customReplyLength ?? 150}
            onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }}
            onBlur={event => { const value = Number(event.target.value); if (Number.isFinite(value) && value >= 1) commitSetting({ customReplyLength: Math.min(10000, Math.round(value)) }); }} /></label>}
          <label>角色语音<input type="checkbox" role="switch" checked={current.voice !== false} onChange={event => commitSetting({ voice: event.target.checked })} /></label>
          <label>未配置立绘时的通用NPC<select value={current.fallbackNpcGender??"male"} onChange={event=>commitSetting({fallbackNpcGender:event.target.value as "male"|"female"})}><option value="male">男性立绘</option><option value="female">女性立绘</option></select></label>
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
          onBack={() => setPage(mapOrigin)} onSettings={() => { setMapSettingsOrigin("map"); setPage("map-settings"); }} onArrive={arriveFromMap} onLocation={setAudioLocation} />
      </div>}
    {page === "map-settings" && <FacingMapSettings onBack={() => setPage(mapSettingsOrigin)} />}
    {page === "assets" && character && <FacingAssets key={assetOwnerId??character.id} character={characters.find(item=>item.id===assetOwnerId)??character} assets={loadFacingAssets(assetOwnerId??character.id)} groups={groupFacingScenes(loadFacingAssets(assetOwnerId??character.id))} initialAssetId={assetEditId}
      onBack={() => setPage(assetOrigin)} onChange={() => { setAssets(loadFacingUsableAssets(character.id));setPreferences(loadFacingSettings()); }}
      onDelete={async assetIds => {
        await deleteFacingAssets(assetOwnerId??character.id, assetIds);
        setAssets(loadFacingUsableAssets(character.id));
        setPreferences(loadFacingSettings());
      }} />}
    {page === "shared-assets" && <FacingAssets character={{id:FACING_SHARED_CHARACTER_ID,name:"通用场景",avatar:"",createdAt:"",updatedAt:""} as Character} assets={loadFacingAssets(FACING_SHARED_CHARACTER_ID)} groups={groupFacingScenes(loadFacingAssets(FACING_SHARED_CHARACTER_ID))} initialAssetId={assetEditId} onBack={()=>setPage(assetOrigin)} onChange={()=>{if(character)setAssets(loadFacingUsableAssets(character.id));setRecordRevision(v=>v+1);}} onDelete={async ids=>{await deleteFacingAssets(FACING_SHARED_CHARACTER_ID,ids);if(character)setAssets(loadFacingUsableAssets(character.id));}}/>}
    {page === "products" && <FacingProducts assets={assets} onBack={()=>setPage("settings")}/>}
    {page === "records" && character && <>
      <Header title="见面记录" onBack={() => setPage("home")} />
      <main className="facing-scroll facing-form">
        <div className="facing-segments" role="group" aria-label="记录分类">
          {Object.entries(RECORD_TABS).map(([key, label]) => <button type="button" key={key} aria-pressed={recordType === key}
            onClick={() => {setRecordType(key as FacingMeeting["type"]);setRecordSelection([]);setConfirmRecordDelete(false);}}>{label}</button>)}
        </div>
        <div className="facing-row"><span>{character.name}</span><button type="button" className="facing-small" onClick={() => prepareMeeting("independent")}><Plus size={16} />新开独立见面</button></div>
        <section className="facing-form" aria-label="管理见面记录"><button type="button" className="facing-small" disabled={recordBusy||!records.length} onClick={()=>setRecordSelection(recordSelection.length===records.length?[]:records.map(item=>item.id))}>{recordSelection.length===records.length&&records.length?"取消全选":"全选当前分类"}</button><p>已选择 {recordSelection.length} 条；合并保留原始消息与时间，重复消息只保留一次。</p><input aria-label="见面记录名称" value={recordName} onChange={e=>setRecordName(e.target.value)} placeholder="记录名称"/><label><input type="checkbox" checked={removeMergedSources} onChange={e=>setRemoveMergedSources(e.target.checked)}/>合并成功后移除来源记录</label>
          <div className="facing-choices"><button disabled={recordBusy||recordSelection.length!==1||!recordName.trim()} onClick={()=>void (async()=>{setRecordBusy(true);try{await manageFacingMeetings(recordSelection,"rename",recordName);setRecordRevision(v=>v+1);}catch(e){setError(String(e));}finally{setRecordBusy(false);}})()}>改名</button>
          <button disabled={recordBusy||recordSelection.length<2} onClick={()=>void(async()=>{setRecordBusy(true);try{const saved=await mergeFacingMeetings(recordSelection[0],recordSelection,removeMergedSources);setRecordSelection([saved.id]);setMeeting(current=>current?.id===saved.id?saved:current);setRecordRevision(v=>v+1);}catch(e){setError(String(e));}finally{setRecordBusy(false);}})()}>合并到首条所选记录</button>
          <button disabled={recordBusy||!recordSelection.length} onClick={()=>setConfirmRecordDelete(true)}>删除所选</button></div>
          {confirmRecordDelete&&<div role="alert"><p>移除这 {recordSelection.length} 条见面记录？</p><button disabled={recordBusy} onClick={()=>void(async()=>{setRecordBusy(true);try{await manageFacingMeetings(recordSelection,"delete");setMeeting(current=>current&&recordSelection.includes(current.id)?undefined:current);setRecordSelection([]);setConfirmRecordDelete(false);setRecordRevision(v=>v+1);}catch(e){setError(String(e));}finally{setRecordBusy(false);}})()}>确认移除</button><button onClick={()=>setConfirmRecordDelete(false)}>取消</button></div>}
        </section>
        <div className="facing-list">
          {records.map(item => <div className="facing-record-manage" key={item.id}><input type="checkbox" aria-label={`选择记录${item.title||item.id}`} checked={recordSelection.includes(item.id)} onChange={e=>setRecordSelection(old=>e.target.checked?[...old,item.id]:old.filter(id=>id!==item.id))}/>
            <button type="button" onClick={() => { setRecord(item); setPage("record"); }}>
              <span className="facing-record-row"><strong>{item.title || facingMeetingPosition(item).sceneName}</strong>
                <small>{facingMeetingPosition(item).sceneName} · {new Date(item.updatedAt).toLocaleDateString("zh-CN")}</small></span><ChevronRight size={17} />
            </button></div>)}
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
