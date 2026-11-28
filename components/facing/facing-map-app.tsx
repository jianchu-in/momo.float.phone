"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { copyTextPreservingView } from "@/lib/clipboard-view";
import { kvGet, kvSet, registerDynamicPrefix } from "@/lib/kv-db";
import { ChevronLeft, History, Map as MapIcon, Plus, RefreshCw, Settings2, X } from "lucide-react";
import type { Character } from "@/lib/character-types";
import { getCharacterWorldGroup, loadCharacterWorldGroups } from "@/lib/character-world-storage";
import { loadChatScope } from "@/lib/chat-scope-storage";
import { facingId, type FacingMeeting } from "@/lib/facing-storage";
import { deleteMapVisitAndMemories } from "@/lib/facing-memory-deletion";
import { loadWorldBooks, resolveUserIdentity, loadApiConfigs, loadBindingConfig, resolveBinding } from "@/lib/settings-storage";
import { downloadFile } from "@/lib/download-utils";
import { deleteThemeAsset, getThemeAssetDataUrl } from "@/lib/theme-storage";
import { answerMapInvitation, enrichMapGenerationSources, calibrateFacingMap, extensionPosition, planFacingMap, refreshMapActivities, renderFacingMap, polishMapTilePlan, refineFacingMapPlan,
  type MapExtension, type MapPlan } from "@/lib/facing-map-engine";
import { commitMapTile, createFacingAtlas, createMapInterior, loadFacingAtlases, loadFacingAtlas, loadMapPreferences,
  mapPlace, mapPlacePath, mapJourneyRoute, mapJourneyFrame, mapActivitySnapshot, mapBoundaryTile, placeOnMapPage, saveMapPage, saveMapPreferences, storeMapTile, updateFacingAtlas,
  type FacingAtlas, type MapTile, type MapPlace, type MapPoint, type MapPreferences, type MapTrip } from "@/lib/facing-map-storage";
import { MapSceneMatcher } from "./facing-map-scene-matcher";
import { FacingPlaceSettings } from "./facing-place-settings";
import { FacingMapCanvas } from "./facing-map-canvas";
import { MapDimensions, MapSheet, MapExpansionPreview } from "./facing-map-panels";
import { editMapTile, replaceMapTile, removeMapTile, removeMapPlaces, placesForTile, tileForPlace } from "@/lib/facing-map-editing";
import { exportMapPackage, readMapPackage, importMapPackage, installCustomMapTemplate, type MapPackage } from "@/lib/facing-map-transfer";
import { MapTileSheet } from "./facing-map-tile-sheet";
import { MapTransferSheet } from "./facing-map-transfer-sheet";
import { MapTemplateSheet } from "./facing-map-template-sheet";
import { installBuiltinMapTemplate, type MapTemplateTarget } from "@/lib/facing-map-templates";
import { MapTravel, type MapTravelAnimation } from "./facing-map-travel";
import { deleteFacingAtlas, renameFacingAtlas } from "@/lib/facing-map-storage";
import { mapCharacterResidence, mapResidentIds, saveMapResidents } from "@/lib/facing-map-storage";
import { facingParticipantIds } from "@/lib/facing-storage";
import { loadMapPlans, saveMapPlan, formatMapPlan, mapPlanPlaces, validateMapPlan } from "@/lib/facing-map-plans";

registerDynamicPrefix("ai_phone_facing_map_draft_v1:");
type Sheet = "manage" | "transfer" | "templates" | "create" | "sources" | "generate" | "edit" | "animation" | "history" | "travel" | "invitations" | "tiles" | "scene-match" | "place-life" | null;
type MapCandidate = { blob: Blob; url: string; plan: MapPlan; extension?: MapExtension; replacement?: MapTile; uploaded?: boolean };
export function FacingMapApp({ character, characters, currentMeeting, initialParticipantIds, onBack, onSettings, onArrive, onLocation, onRecordsChanged }: {
  onRecordsChanged?: () => void;
  onLocation?: (location:{atlasId:string;placeId:string}|undefined)=>void;
  character: Character; characters: Character[]; currentMeeting?: FacingMeeting; initialParticipantIds?: string[];
  onBack: () => void; onSettings: () => void;
  onArrive: (atlas: FacingAtlas, trip: MapTrip, visitId: string) => Promise<void>;
}) {
  const worldId = mapCharacterResidence(character.id) ?? getCharacterWorldGroup(character.id)?.id ?? character.id;
  const world = loadCharacterWorldGroups().find(item => item.id === worldId);
  const [atlas, setAtlas] = useState<FacingAtlas | undefined>(() => loadFacingAtlases(worldId)[0]);
  const residents=useMemo(()=>atlas?new Set(mapResidentIds(atlas)):undefined,[atlas]);
  const members = characters.filter(item => atlas ? residents!.has(item.id) : (world?.memberIds.includes(item.id) ?? item.id === character.id) && (!mapCharacterResidence(item.id) || mapCharacterResidence(item.id) === worldId));
  const [pageId, setPageId] = useState(atlas?.pages[0]?.id);
  const [sceneMatchPlaceId,setSceneMatchPlaceId]=useState<string>();
  const [selectedId, setSelectedId] = useState<string>();
  const [sheet, setSheet] = useState<Sheet>(atlas ? null : "create");
  const [settings, setSettings] = useState(loadMapPreferences);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [mapName, setMapName] = useState(world?.name ?? "我的世界地图");
  const [characterIds, setCharacterIds] = useState(members.map(item => item.id));
  const [bookIds, setBookIds] = useState<string[]>([]);
  const [referenceCharacterIds,setReferenceCharacterIds]=useState<string[]>(members.map(item=>item.id));
  const [includeUser,setIncludeUser]=useState(false);
  const planEditor=useRef<HTMLFieldSetElement>(null);
  const [requirement, setRequirement] = useState("");
  const [plan, setPlan] = useState<MapPlan>({ description: "", places: [] });
  const [planId, setPlanId] = useState("");
  const [planName, setPlanName] = useState("");
  const [notice, setNotice] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [visitDeleteId, setVisitDeleteId] = useState<string>();
  const [extension, setExtension] = useState<MapExtension>();
  const [candidate, setCandidate] = useState<MapCandidate>();
  const [placeDraft, setPlaceDraft] = useState<MapPlace>();
  const [editing, setEditing] = useState(false);
  const [tileEditing, setTileEditing] = useState(false);
  const [selectedTileId, setSelectedTileId] = useState<string>();
  const [replacement, setReplacement] = useState<MapTile>();
  const [referenceOriginal, setReferenceOriginal] = useState(true);
  const [imported, setImported] = useState<MapPackage>();
  const [importAsTemplate, setImportAsTemplate] = useState(false);
  const [companions, setCompanions] = useState<string[]>([]);
  const [targetCharacter, setTargetCharacter] = useState<string>();
  const [secret, setSecret] = useState(false);
  const [snapshotId, setSnapshotId] = useState<string>();
  const [invitationId, setInvitationId] = useState<string>();
  const [animation, setAnimation] = useState<MapTravelAnimation>();
  const [progress, setProgress] = useState(0);
  const [visitId, setVisitId] = useState("");
  const controller = useRef<AbortController | null>(null);
  const lock = useRef(false);
  const uploading = useRef<HTMLInputElement>(null);
  const page = atlas?.pages.find(item => item.id === pageId) ?? atlas?.pages[0];
  const selected = page?.places.find(item => item.id === selectedId);
  const snapshot = atlas ? mapActivitySnapshot(atlas, snapshotId) : undefined;
  const identity = resolveUserIdentity(character.id, "facing");
  const identityId = identity?.id ?? null;
  const identityKey = identityId ?? "default";
  const userPlaceId = atlas?.userPlaces[identityKey];
  useEffect(()=>{onLocation?.(atlas&&(page?.parentPlaceId||userPlaceId)?{atlasId:atlas.id,placeId:page?.parentPlaceId||userPlaceId!}:undefined);},[atlas,page?.id,userPlaceId,onLocation]);
  const invitation = atlas?.invitations.find(item => item.id === invitationId);
  const selectedActivities = atlas && selected && page ? (snapshot?.entries ?? []).filter(entry => placeOnMapPage(atlas, entry.placeId, page.id)?.id === selected.id) : [];
  const api = loadApiConfigs().find(item => item.id === resolveBinding(loadBindingConfig(), character.id, "facing").apiConfigId);
  const books = loadWorldBooks();

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => () => { if (candidate) URL.revokeObjectURL(candidate.url); }, [candidate]);
  useEffect(()=>{
    if(sheet!=="generate"||!atlas||!page||replacement)return;
    kvSet(`ai_phone_facing_map_draft_v1:${atlas.id}:${page.id}:${extension?.direction??"base"}`,JSON.stringify({plan,planId,planName,requirement,width:settings.width,height:settings.height,referenceCharacterIds,includeUser}));
  },[sheet,atlas?.id,page?.id,plan,planId,planName,requirement,settings.width,settings.height,extension?.direction,replacement?.id,referenceCharacterIds,includeUser]);
  function reload() { if (atlas) setAtlas(loadFacingAtlas(atlas.id) ?? undefined); }
  async function run(label: string, action: (signal: AbortSignal) => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    const control = new AbortController(); controller.current = control;
    setBusy(label); setError("");
    try { await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))); if(!control.signal.aborted)await action(control.signal); }
    catch (cause) { if (!control.signal.aborted) setError(cause instanceof Error ? cause.message : "操作失败，请重试。"); }
    finally { lock.current = false; controller.current = null; setBusy(""); }
  }
  function closeSheet() {
    if (busy) return;
    setSheet(null); setError(""); setVisitDeleteId(undefined);
  }
  function toggle(list: string[], value: string) { return list.includes(value) ? list.filter(id => id !== value) : [...list, value]; }
  function openGenerate(direction?: MapExtension["direction"]) {
    if (!page) return;
    setReplacement(undefined);
    setExtension(direction && page.tiles.length ? { direction, tile: mapBoundaryTile(page, direction) } : undefined);
    const draftKey=`ai_phone_facing_map_draft_v1:${atlas?.id}:${page.id}:${direction??"base"}`;
    let previous:{plan:MapPlan;planId:string;planName:string;requirement:string;width:number;height:number;referenceCharacterIds?:string[];includeUser?:boolean}|undefined;try{previous=JSON.parse(kvGet(draftKey)??"null");}catch{}
    setReferenceCharacterIds(previous?.referenceCharacterIds??members.map(item=>item.id));setIncludeUser(previous?.includeUser??false);
    setPlan(previous?.plan??{ description: page.parentPlaceId ? `绘制「${page.name}」的内部平面图，保留清晰的房间、设施和通道。` : "", places: [] });
    setCandidate(undefined); setRequirement(previous?.requirement??""); setError("");
    setPlanId(previous?.planId??""); setPlanName(previous?.planName??`${page.name}文字方案`); setNotice("");
    setSettings({ ...loadMapPreferences(), ...(previous?{width:previous.width,height:previous.height}:{}), ...(page.parentPlaceId && !previous ? { width: 1536, height: 1152 } : {}) });
    setSheet("generate");
    setBookIds([...(atlas?.worldBookIds ?? [])]);
  }
  async function create() {
    if (!mapName.trim()) { setError("请填写地图名称。"); return; }
    await run("创建地图", async () => {
      const saved = await createFacingAtlas(worldId, mapName.trim(), characterIds, bookIds);
      setAtlas(saved); setPageId(saved.pages[0].id); setSheet(null);
    });
  }
  function editSources() {
    if (!atlas) return;
    setCharacterIds([...mapResidentIds(atlas)]); setBookIds([...atlas.worldBookIds]); setMapName(atlas.name); setSheet("sources");
  }
  async function saveSources() {
    if (!atlas || !mapName.trim()) return;
    await run("保存生活角色", async () => {
      setAtlas(await saveMapResidents(atlas, characterIds));
      setSheet(null);
    });
  }
  async function generatePlan() {
    if (!atlas || !page) return;
    await run("正在生成文字方案…", async signal => {
      if (JSON.stringify(atlas.worldBookIds) !== JSON.stringify(bookIds)) setAtlas(await updateFacingAtlas(atlas.id, current => ({ ...current, worldBookIds: bookIds })));
      const sources = await enrichMapGenerationSources({ atlas, characters, worldBookIds: bookIds, referenceCharacterIds, includeUser },signal);
      const result = replacement ? await polishMapTilePlan(character, plan, requirement, settings, signal, sources)
        : plan.description.trim() ? await refineFacingMapPlan(character, plan, requirement, settings, signal, sources)
        : await planFacingMap(character, atlas, page, characters, requirement, settings, signal, extension, sources);
      setPlan(result); setCandidate(undefined);
    });
  }
  async function generateImage() {
    if (replacement && (![replacement.width, replacement.height, replacement.x, replacement.y].every(Number.isFinite) || replacement.width <= 0 || replacement.height <= 0)) { setError("请填写有效的图块坐标和宽高。"); return; }
    if (!plan.description.trim() || !atlas || !page) { setError("请先生成或填写地图描述。"); return; }
    await run("正在生成地图图片…", async signal => {
      if (JSON.stringify(atlas.worldBookIds) !== JSON.stringify(bookIds)) setAtlas(await updateFacingAtlas(atlas.id, current => ({ ...current, worldBookIds: bookIds })));
      validateMapPlan(plan);
      const savedPlan = { ...plan, places: plan.places.map(place => ({ ...place })) };
      const result = await renderFacingMap(character, savedPlan, settings, signal, extension, referenceOriginal ? replacement : undefined, await enrichMapGenerationSources({ atlas, characters, worldBookIds: bookIds, referenceCharacterIds, includeUser },signal));
      if (!signal.aborted) setCandidate({ blob: result.blob, url: URL.createObjectURL(result.blob), plan: savedPlan, extension, replacement });
    });
  }
  async function saveTilePlan() {
    if (!atlas || !page || !replacement || !plan.description.trim()) return;
    await run("保存图块方案", async () => {
      const tile = { ...replacement, description: plan.description };
      const places = plan.places.map(place => ({ ...place, tileId: tile.id,
        x: tile.x + place.x / 1000 * tile.width, y: tile.y + place.y / 1000 * tile.height }));
      setAtlas(await replaceMapTile(atlas.id, page.id, tile, places));
      setSheet(null); setCandidate(undefined);
    });
  }
  async function saveImage() {
    if (!atlas || !page || !candidate) return;
    await run("保存地图图片", async () => {
      validateMapPlan(candidate.plan);
      if (candidate.replacement && (![candidate.replacement.x, candidate.replacement.y, candidate.replacement.width, candidate.replacement.height].every(Number.isFinite)
        || candidate.replacement.width <= 0 || candidate.replacement.height <= 0)) throw new Error("请填写有效的图块区域宽高。");
      const tile = await storeMapTile(candidate.blob, { x: 0, y: 0 });
      tile.name = candidate.replacement?.name || `图块 ${page.tiles.length + 1}`;
      tile.description = candidate.plan.description;
      if (candidate.replacement) {
        const previous = candidate.replacement;
        tile.id = previous.id; tile.x = previous.x; tile.y = previous.y;
        tile.width = previous.width; tile.height = previous.height;
        const places = mapPlanPlaces(candidate.plan, tile, true);
        try {
          setAtlas(await replaceMapTile(atlas.id, page.id, tile, places));
        } catch (cause) { await deleteThemeAsset(tile.mediaId).catch(() => {}); throw cause; }
      } else {
        Object.assign(tile, extensionPosition(candidate.extension?.tile, candidate.extension?.direction ?? "right", tile.width, tile.height));
        const newPlaces = mapPlanPlaces(candidate.plan, tile);
        setAtlas(await commitMapTile(atlas.id, page.id, tile, newPlaces, candidate.plan.description));
      }
      setSheet(null); setCandidate(undefined); setSelectedId(undefined);
    });
  }
  async function upload(file: File) {
    if (!atlas || !page) return;
    setError("");
    try {
      validateMapPlan(plan);
      if (!file.type.startsWith("image/") || !file.size || file.size > 30 * 1024 * 1024) throw new Error("请选择不超过30 MB的地图图片。");
      setCandidate({ blob: file, url: URL.createObjectURL(file), plan: structuredClone(plan), extension, replacement, uploaded: true });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法读取已有地图。"); }
  }

  async function persistPlan(asNew = false) {
    await run("保存文字方案", async () => {
      const saved = await saveMapPlan({ ...plan, sourcePageId:page?.id, id: asNew ? undefined : planId || undefined, worldId, name: planName, width: settings.width, height: settings.height });
      setPlanId(saved.id); setPlanName(saved.name); setNotice("文字方案已保存，可随时选择后生图或上传已有地图。");
    });
  }
  async function copyPlan() {
    setError("");
    try {
      const content = formatMapPlan(plan, settings);
      await copyTextPreservingView(content,planEditor.current);
      setNotice("已复制地图描述、地点清单与坐标。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "复制失败。"); }
  }
  function selectPlace(id: string) { setSelectedId(id); }
  function addPoint(point: MapPoint) {
    if (tileEditing) return;
    if (editing) { setPlaceDraft({ ...point, id: facingId(), name: "", description: "", tileId: tileForPlace(page!, { ...point, id: "", name: "", description: "" })?.id }); setSheet("edit"); }
    else setSelectedId(undefined);
  }
  async function movePlace(id: string, point: MapPoint) {
    if (!atlas || !page || busy) return;
    await run("保存位置", async () => {
      const fresh = loadFacingAtlas(atlas.id)?.pages.find(item => item.id === page.id) ?? page;
      setAtlas(await saveMapPage(atlas.id, { ...fresh, places: fresh.places.map(place => place.id === id ? { ...place, ...point, tileId: tileForPlace(fresh, { ...place, ...point, tileId: undefined })?.id } : place) }));
    });
  }
  async function savePlace(remove = false) {
    if (!atlas || !page || !placeDraft || (!remove && !placeDraft.name.trim())) return;
    await run("保存地点", async () => {
      setAtlas(await updateFacingAtlas(atlas.id, current => {
        if (remove) return removeMapPlaces(current, [placeDraft.id]);
        return { ...current, pages: current.pages.map(item => item.id !== page.id ? item : { ...item,
          places: item.places.some(place => place.id === placeDraft.id)
            ? item.places.map(place => place.id === placeDraft.id ? { ...placeDraft, name: placeDraft.name.trim() } : place)
            : [...item.places, { ...placeDraft, name: placeDraft.name.trim() }] }) };
      }));
      setSheet(null); if (remove) setSelectedId(undefined);
    });
  }
  async function interior() {
    if (!atlas || !selected) return;
    await run("打开内部地图", async () => {
      const saved = await createMapInterior(atlas.id, selected);
      setAtlas(saved); setPageId(saved.pages.find(item => item.parentPlaceId === selected.id)!.id); setSelectedId(undefined);
    });
  }
  async function applyTemplate(id: string, target: MapTemplateTarget) {
    if (!atlas) return;
    await run("正在加入内置场所…", async signal => {
      const saved = id.startsWith("custom:") ? await installCustomMapTemplate(atlas.id, id.slice(7), target, signal)
        : await installBuiltinMapTemplate(atlas.id, id, target, signal);
      setAtlas(saved.atlas); setPageId(saved.pageId); setSelectedId(undefined); setSheet(null);
    });
  }
  function regenerate(tile: MapTile) {
    if (!page) return;
    setReplacement(tile); setExtension(undefined); setReferenceOriginal(true);
    setPlan({ description: tile.description || page.description || `绘制「${tile.name || page.name}」的地图，保持原有建筑与房间布局。`,
      places: placesForTile(page, tile.id).map(place => ({ ...place, x: (place.x - page.tiles.find(item => item.id === tile.id)!.x) / page.tiles.find(item => item.id === tile.id)!.width * 1000,
        y: (place.y - page.tiles.find(item => item.id === tile.id)!.y) / page.tiles.find(item => item.id === tile.id)!.height * 1000 })) });
    setSettings({ ...loadMapPreferences(), width: tile.pixelWidth, height: tile.pixelHeight });
    setPlanId(""); setPlanName(`${tile.name || page.name}文字方案`); setNotice("");
    setCandidate(undefined); setRequirement(""); setSheet("generate"); setError("");
  }
  async function saveTile(tile: MapTile, order?: "front" | "back") {
    if (!atlas || !page) return;
    await run("保存图块", async () => {
      const saved = await editMapTile(atlas.id, page.id, tile, order);
      setAtlas(saved); setSelectedTileId(tile.id); setSheet(null);
    });
  }
  async function exportMap(place: boolean) {
    if (!atlas) return;
    await run("正在打包地图和原图…", async signal => {
      const data = await exportMapPackage(atlas, signal, place ? selectedId : undefined);
      await downloadFile(new Blob([JSON.stringify(data)], { type: "application/json" }), `${data.name.replace(/[\\/:*?"<>|]/g, "_")}-${place ? "场所模板" : "完整地图"}.json`);
    });
  }
  async function readImport(file: File) {
    setImported(undefined);
    await run("正在读取地图文件…", async signal => {
      const data = await readMapPackage(file, signal); setImported(data); setImportAsTemplate(data.kind !== "atlas");
    });
  }
  async function importMap() {
    if (!imported) return;
    await run("正在导入地图和原图…", async signal => {
      const result = await importMapPackage(imported, worldId, members.map(item => item.id), signal, importAsTemplate);
      if (result.atlas) { setAtlas(result.atlas); setPageId(result.atlas.pages[0]?.id); setSelectedId(undefined); setSheet(null); }
      else setSheet(atlas ? "templates" : null);
      setImported(undefined);
    });
  }
  async function refresh() {
    if (!atlas) return;
    await run("正在读取记忆并刷新动向…", async signal => {
      const result = await refreshMapActivities(character, atlas, characters, signal);
      setAtlas(await updateFacingAtlas(atlas.id, current => ({ ...current, snapshots: [...current.snapshots, result] })));
      setSnapshotId(undefined);
    });
  }
  const travelMembers=characters.filter(item=>members.some(member=>member.id===item.id)||(currentMeeting?facingParticipantIds(currentMeeting):initialParticipantIds??[]).includes(item.id));
  function prepareTrip(targetId?: string) {
    const active=currentMeeting?facingParticipantIds(currentMeeting):initialParticipantIds??[character.id];
    setCompanions(targetId?[]:active.filter(id=>travelMembers.some(item=>item.id===id)));
    setTargetCharacter(targetId); setSecret(false); setError(""); setSheet("travel");
  }
  function beginTrip(characterIds: string[], placeId = selectedId, invited = false) {
    if (!atlas || !page || !placeId) return;
    const path = mapJourneyRoute(atlas, userPlaceId ?? "", placeId);
    const paths = path ? [{ segments: path }, ...characterIds.map(id => {
      const member = characters.find(item => item.id === id);
      return { character: member, segments: path };
    })] : [];
    setVisitId(facingId()); setProgress(0); setSheet(null);
    if (settings.animation === "route" && path) { setPageId(path[0].pageId); setSelectedId(undefined); }
    setAnimation({ mode: settings.animation, trip: { placeId, characterIds, secret: !characterIds.length && secret,
      targetCharacterId: invited ? undefined : targetCharacter }, paths });
  }
  async function invite() {
    if (!atlas || !selected || !companions.length) return;
    await run("正在发送邀请并等待回应…", async signal => {
      const entry = { id: facingId(), placeId: selected.id, createdAt: new Date().toISOString(), identityId, chatAccountId: loadChatScope().chatAccountId,
        recipients: companions.map(characterId => ({ characterId, status: "waiting" as const })) };
      setAtlas(await updateFacingAtlas(atlas.id, current => ({ ...current, invitations: [...current.invitations, entry] })));
      setInvitationId(entry.id); setSheet("invitations");
      await Promise.allSettled(companions.map(async id => {
        const recipient = characters.find(item => item.id === id);
        if (recipient) await answerMapInvitation(character, atlas.id, entry.id, recipient, signal);
        setAtlas(loadFacingAtlas(atlas.id) ?? atlas);
      }));
    });
  }
  async function retryInvitation(id: string) {
    if (!atlas || !invitation) return;
    await run("等待角色回应…", async signal => {
      const recipient = characters.find(item => item.id === id);
      if (recipient) await answerMapInvitation(character, atlas.id, invitation.id, recipient, signal);
      reload();
    });
  }
  async function arrive() {
    if (!atlas || !animation) return;
    await onArrive(loadFacingAtlas(atlas.id) ?? atlas, animation.trip, visitId);
  }
  const sceneTitle = page?.parentPlaceId && atlas ? mapPlacePath(atlas, page.parentPlaceId) : atlas?.name ?? "世界地图";
  const animatedPaths = animation?.paths.flatMap(path => {
    const frame = mapJourneyFrame(path.segments, progress);
    return frame && frame.pageId === page?.id ? [{ character: path.character, points: frame.points, progress: frame.progress }] : [];
  }) ?? [];
  return <section className="fmap-app">
    <header className="facing-header">
      <button type="button" className="facing-back" aria-label="返回" disabled={!!busy || !!animation} onClick={() => {
        if (page?.parentPlaceId && atlas) { setPageId(mapPlace(atlas, page.parentPlaceId)?.page.id); setSelectedId(undefined); }
        else onBack();
      }}><ChevronLeft size={22} /></button>
      <div className="fmap-heading"><h1>{sceneTitle}</h1><small>{world?.name ?? "当前世界"}</small></div>
      <button type="button" className="facing-icon" aria-label="地图设置" disabled={!!busy || !!animation} onClick={onSettings}><Settings2 size={20} /></button>
    </header>
    {atlas && page ? <>
      <div className="fmap-toolbar">
        <select aria-label="选择地图" value={atlas.id} disabled={!!busy || !!animation} onChange={event => {
          const next = loadFacingAtlas(event.target.value);
          if (next) { setAtlas(next); setPageId(next.pages[0]?.id); setSelectedId(undefined); setSnapshotId(undefined); }
        }}>{loadFacingAtlases(worldId).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <button type="button" className="facing-small" disabled={!!busy || !!animation} onClick={() => setSheet("create")}><Plus size={14} />新建</button>
        <button type="button" className="facing-small" disabled={!!busy || !!animation} onClick={() => { setMapName(atlas.name); setDeleteConfirm(false); setSheet("manage"); }}>管理地图</button>
        <button type="button" className="facing-small" disabled={!!busy || !!animation} onClick={() => { setEditing(!editing); setTileEditing(false); }} aria-pressed={editing}>{editing ? "完成编辑" : "编辑地图"}</button>
      </div>
      <div className="fmap-stage" data-blurred={animation?.mode === "car" ? "true" : undefined}>
        <FacingMapCanvas atlas={atlas} page={page} characters={characters} snapshot={snapshot} selectedId={selectedId}
          userPlaceId={userPlaceId} userAvatar={identity?.avatarUrl} userName={identity?.name ?? "你"}
          editing={editing && !busy && !animation} tileEditing={tileEditing && !busy && !animation} selectedTileId={selectedTileId}
          onTile={setSelectedTileId} onTileMove={(id, point) => { const tile = page.tiles.find(item => item.id === id); if (tile && !busy) void saveTile({ ...tile, ...point }); }}
          travel={animation?.mode === "route" ? { paths: animatedPaths, dashed: settings.line === "dashed" } : undefined}
          onPlace={id => { if (!busy && !animation) void selectPlace(id); }} onPoint={point => { if (!busy && !animation) addPoint(point); }}
          onMove={(id, point) => void movePlace(id, point)} />
      {tileEditing && !animation && <div className="fmap-tile-tools"><span>拖动图块调整位置</span><button type="button" className="facing-small" onClick={() => setSheet("tiles")}>编辑所选图块</button><button type="button" className="facing-small" onClick={() => setTileEditing(false)}>完成移动</button></div>}
      {selected && !tileEditing && !animation && <div className="fmap-detail">
        <div className="facing-row"><h2>{selected.name}</h2><button className="facing-icon" aria-label="关闭地点介绍" onClick={() => setSelectedId(undefined)}><X size={16} /></button></div>
        <p>{selected.description || "可以在编辑模式里补充地点介绍。"}</p>
        {selectedActivities.map(entry => {
          const member = characters.find(item => item.id === entry.characterId);
          return member && <button key={entry.characterId} className="fmap-character" onClick={() => {
            const location = mapPlace(atlas, entry.placeId);
            if (location) { setPageId(location.page.id); setSelectedId(location.place.id); }
            prepareTrip(member.id);
          }}>
            {member.avatar ? <img src={member.avatar} alt="" /> : <span>{member.name.slice(0, 1)}</span>}
            <span><strong>{member.name}</strong><small>{entry.activity} · {mapPlacePath(atlas, entry.placeId)}</small><small>{new Date(entry.time).toLocaleString("zh-CN")}</small></span><span>去找他</span>
          </button>;
        })}
        <div className="facing-choices">
          <button type="button" className="facing-small" disabled={!!busy} onClick={()=>setSheet("place-life")}>家的归属与氛围音</button>
          <button type="button" className="facing-small" disabled={!!busy} onClick={()=>{setSceneMatchPlaceId(selected.id);setSheet("scene-match");}}>设置地点场景</button>
          <button type="button" className="facing-small" disabled={!!busy} onClick={() => void interior()}>进入内部地图</button>
          <button type="button" className="facing-small" disabled={!!busy} onClick={() => setSheet("templates")}>套用场所模板</button>
          <button type="button" className="facing-primary" disabled={!!busy} onClick={() => prepareTrip()}>前往这里</button>
          <button type="button" className="facing-small" disabled={!!busy} onClick={() => void exportMap(true)}>导出此地点</button>
          <button type="button" className="facing-small" disabled={!!busy} aria-pressed={userPlaceId === selected.id} onClick={() => void run("设置当前位置", async () => {
            setAtlas(await updateFacingAtlas(atlas.id, current => ({ ...current, userPlaces: { ...current.userPlaces, [identityKey]: selected.id } })));
          })}>{userPlaceId === selected.id ? "我的当前位置" : "设为我的位置"}</button>
          {editing && <>
            {page.parentPlaceId && <button type="button" className="facing-small" disabled={!!busy}
              aria-pressed={page.entryPlaceId === selected.id} onClick={() => void run("保存地图入口", async () => {
                setAtlas(await saveMapPage(atlas.id, { ...page, entryPlaceId: selected.id }));
              })}>{page.entryPlaceId === selected.id ? "当前地图入口" : "设为本地图入口"}</button>}
            <button type="button" className="facing-small" onClick={() => { setPlaceDraft({ ...selected }); setSheet("edit"); }}>编辑地点</button>
          </>}
        </div>
      </div>}
      </div>
      {!animation && <footer className="fmap-footer">
        {editing && <p className="fmap-note">轻点空白处添加地点；拖动标记调整位置。</p>}
        <div className="facing-choices">
          <button type="button" className="facing-small" disabled={!!busy} onClick={() => setSheet("templates")}>详细场所模板</button>
          <button type="button" className="facing-small" disabled={!!busy} onClick={() => openGenerate()}>生成地图</button>
          <button type="button" className="facing-small" disabled={!!busy} onClick={editSources}>生活角色 · {members.length}</button>
          <button type="button" className="facing-small" disabled={!!busy} onClick={()=>{setSceneMatchPlaceId(page.parentPlaceId);setSheet("scene-match");}}>匹配场景素材</button>
          {page.parentPlaceId&&<button type="button" className="facing-small" disabled={!!busy} onClick={()=>{setSelectedId(undefined);setSheet("place-life");}}>本大地点的家与氛围音</button>}
          <button type="button" className="facing-small" disabled={!!busy} onClick={() => setSheet("tiles")}>图块与扩展</button>
          <button type="button" className="facing-small" disabled={!!busy} onClick={() => setSheet("transfer")}>导入 / 导出</button>
          <button type="button" className="facing-small" disabled={!!busy} onClick={() => { setSettings(loadMapPreferences()); setSheet("animation"); }}>移动动画</button>
          <button type="button" className="facing-small" disabled={!!busy || !page.places.length} onClick={() => void refresh()}><RefreshCw size={13} />刷新动向 · 文字API</button>
          <button type="button" className="facing-small" disabled={!!busy} onClick={() => setSheet("history")}><History size={13} />历史</button>
        </div>
        {snapshot && <small>{snapshotId ? "正在查看历史动向" : "最近刷新"} · {new Date(snapshot.createdAt).toLocaleString("zh-CN")}</small>}
      </footer>}
      {animation && <MapTravel animation={animation} duration={settings.duration} destination={mapPlacePath(atlas, animation.trip.placeId)}
        characters={characters} userName={identity?.name ?? "你"} userAvatar={identity?.avatarUrl} onProgress={value => {
          setProgress(value);
          if (animation.mode === "route") {
            const frame = mapJourneyFrame(animation.paths[0]?.segments ?? [], value);
            if (frame && frame.pageId !== pageId) setPageId(frame.pageId);
          }
        }} onArrive={arrive} onCancel={() => setAnimation(undefined)} />}
    </> : <div className="facing-home-empty"><MapIcon size={42} /><p>为这个世界创建一张地图</p><button className="facing-primary" onClick={() => setSheet("create")}>创建地图</button><button className="facing-small" onClick={() => setSheet("transfer")}>导入地图或模板</button></div>}
    {sheet === "templates" && atlas && page && <MapTemplateSheet atlas={atlas} page={page} selectedId={selectedId} busy={!!busy}
      onImport={() => setSheet("transfer")} onApply={(id, target) => void applyTemplate(id, target)} onClose={closeSheet} />}
    {busy && <div className="fmap-busy" role="status">{busy}<button type="button" onClick={() => controller.current?.abort()}>停止</button></div>}
    {error && <p className="facing-error fmap-error" role="alert">{error}</p>}
    <input ref={uploading} type="file" hidden accept="image/*" onChange={event => {
      const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void upload(file);
    }} />
    {sheet === "manage" && atlas && <MapSheet title="管理世界地图" onClose={closeSheet}>
      <label>地图名称<input aria-label="地图新名称" value={mapName} disabled={!!busy} onChange={event => setMapName(event.target.value)} /></label>
      <button type="button" className="facing-primary" disabled={!!busy || !mapName.trim()} onClick={() => void run("保存地图名称", async () => {
        setAtlas(await renameFacingAtlas(atlas.id, mapName)); setSheet(null);
      })}>保存名称</button>
      {!deleteConfirm ? <button type="button" className="facing-link facing-delete" disabled={!!busy} onClick={() => setDeleteConfirm(true)}>删除这张世界地图</button>
        : <div className="fmap-delete-confirm" role="alert">
          <p>删除「{atlas.name}」及其中全部图块、地点和内部地图？已保存的文字方案与见面记录会保留。</p>
          <div className="facing-pair"><button type="button" className="facing-soft" disabled={!!busy} onClick={() => setDeleteConfirm(false)}>取消</button>
            <button type="button" className="facing-primary" disabled={!!busy} onClick={() => void run("删除世界地图", async () => {
              await deleteFacingAtlas(atlas.id);
              const next = loadFacingAtlases(worldId)[0];
              setAtlas(next); setPageId(next?.pages[0]?.id); setSelectedId(undefined); setSnapshotId(undefined); setInvitationId(undefined);
              setCandidate(undefined); setSelectedTileId(undefined); setEditing(false); setTileEditing(false); setSheet(null);
            })}>确认删除地图</button></div>
        </div>}
    </MapSheet>}
    {(sheet === "create" || sheet === "sources") && <MapSheet title={sheet === "create" ? "创建世界地图" : "生活角色"} onClose={closeSheet}>
      {sheet === "create" && <label>地图名称<input value={mapName} onChange={event => setMapName(event.target.value)} /></label>}
      <fieldset><legend>在这个世界生活的角色（可多选）</legend>{characters.map(item => <label key={item.id} className="fmap-check">
        <input type="checkbox" disabled={!characterIds.includes(item.id) && !!mapCharacterResidence(item.id) && mapCharacterResidence(item.id) !== worldId} checked={characterIds.includes(item.id)} onChange={() => setCharacterIds(toggle(characterIds, item.id))} />{item.name}{mapCharacterResidence(item.id) && mapCharacterResidence(item.id) !== worldId && <small>已在其他世界生活</small>}
      </label>)}</fieldset>
      {sheet === "create" && <fieldset><legend>参考世界书（可多选）</legend>{books.map(book => <label key={book.id} className="fmap-check">
        <input type="checkbox" checked={bookIds.includes(book.id)} onChange={() => setBookIds(toggle(bookIds, book.id))} />{book.name}
      </label>)}{!books.length && <p>暂无世界书</p>}</fieldset>}
      <p className="fmap-note">生活角色决定这个世界的居民、地图动向与同行名单；先从原世界移除，才能加入另一个世界。生成地图时可以另选参考世界书。</p>
      <button type="button" className="facing-primary" disabled={!!busy} onClick={() => void (sheet === "create" ? create() : saveSources())}>{sheet === "create" ? "创建并打开" : "保存生活角色"}</button>
    </MapSheet>}
    {sheet === "scene-match" && atlas && page && <MapSceneMatcher atlas={atlas} page={page} placeId={sceneMatchPlaceId} characters={characters} initialCharacterId={character.id} onClose={closeSheet} onSave={setAtlas}/>}
    {sheet === "place-life" && atlas && (selected||page?.parentPlaceId) && <FacingPlaceSettings atlas={atlas} placeId={selected?.id||page!.parentPlaceId!} characters={members} onSave={setAtlas} onClose={closeSheet} onMatch={(current,id)=>{setAtlas(current);setSceneMatchPlaceId(id);setSheet("scene-match");}}/>}
    {sheet === "generate" && <MapSheet title={replacement ? "升级图块与重新生图" : extension ? "扩展地图" : "生成地图"} onClose={closeSheet}>
      <fieldset ref={planEditor} className="fmap-operation-fields" disabled={!!busy}>
      <details><summary>生成参考资料 · 角色与记忆</summary>
        <fieldset><legend>参考角色及其记忆</legend>{members.map(item=><label className="fmap-check" key={item.id}><input type="checkbox" checked={referenceCharacterIds.includes(item.id)} onChange={()=>setReferenceCharacterIds(toggle(referenceCharacterIds,item.id))}/>{item.name}</label>)}</fieldset>
        <label className="fmap-check"><input type="checkbox" checked={includeUser} onChange={event=>setIncludeUser(event.target.checked)}/>参考用户资料与特点</label><p className="fmap-note">本世界生活角色：{members.map(item => item.name).join("、") || "暂无"}。可在生活角色中管理；参考其他世界书不会增加生活角色。</p>
        {books.map(book => <label className="fmap-check" key={book.id}><input type="checkbox" checked={bookIds.includes(book.id)} onChange={() => setBookIds(toggle(bookIds, book.id))} />{book.name}</label>)}
      </details>
      <label>选择已有文字方案<select aria-label="选择已有文字方案" value={planId} onChange={event => {
        const saved = loadMapPlans(worldId).find(item => item.id === event.target.value);
        if (!saved) { setPlanId(""); return; }
        setPlanId(saved.id); setPlanName(saved.name); setPlan({ description: saved.description, places: saved.places.map(place => ({ ...place })) });
        setSettings(current => ({ ...current, width: saved.width, height: saved.height })); setCandidate(undefined); setNotice("已载入文字方案，可以继续编辑或润色。");
      }}><option value="">当前草稿</option>{loadMapPlans(worldId).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>补充要求<textarea aria-label="补充要求" value={requirement} onChange={event => setRequirement(event.target.value)} placeholder="描述这个世界的范围或想增加的区域。" /></label>
      <button type="button" className="facing-soft" disabled={!!busy} onClick={() => void generatePlan()}>{replacement ? "润色现有描述" : plan.description.trim() ? "继续增加与润色方案" : "生成文字方案"} · {api?.defaultModel ?? "请配置文字API"}</button>
      <label>地图画面描述<textarea aria-label="地图画面描述" className="fmap-description" value={plan.description} onChange={event => { setPlan({ ...plan, description: event.target.value }); setCandidate(undefined); }} /></label>
      <details><summary>地点清单与坐标（{plan.places.length}）</summary>
        <p className="fmap-note">坐标从0到1000，以本次生成图片的左上角为起点。</p>
        {plan.places.map((place, index) => <div className="fmap-plan-place" key={place.id}>
          <input aria-label={`地点${index + 1}名称`} value={place.name} onChange={event => {
            setPlan({ ...plan, places: plan.places.map(item => item.id === place.id ? { ...item, name: event.target.value } : item) }); setCandidate(undefined);
          }} />
          <textarea aria-label={`地点${index + 1}介绍`} value={place.description} onChange={event => {
            setPlan({ ...plan, places: plan.places.map(item => item.id === place.id ? { ...item, description: event.target.value } : item) }); setCandidate(undefined);
          }} />
          <div className="facing-pair">{(["x", "y"] as const).map(axis => <label key={axis}>{axis.toUpperCase()}<input type="number" min={0} max={1000} value={place[axis]}
            onChange={event => { setPlan({ ...plan, places: plan.places.map(item => item.id === place.id ? { ...item, [axis]: Math.max(0, Math.min(1000, +event.target.value)) } : item) }); setCandidate(undefined); }} /></label>)}</div>
          <button type="button" className="facing-link" onClick={() => { setPlan({ ...plan, places: plan.places.filter(item => item.id !== place.id) }); setCandidate(undefined); }}>移除此地点</button>
        </div>)}
        <button type="button" className="facing-small" onClick={() => { setPlan({ ...plan, places: [...plan.places, { id: facingId(), name: "新地点", description: "", x: 500, y: 500 }] }); setCandidate(undefined); }}>添加地点</button>
      </details>
      <label>文字方案名称<input aria-label="文字方案名称" value={planName} onChange={event => setPlanName(event.target.value)} /></label>
      <div className="facing-choices">
        <button type="button" className="facing-small" disabled={!plan.description.trim() || !planName.trim()} onClick={() => void persistPlan()}>{planId ? "更新已保存文字方案" : "保存为文字方案"}</button>
        {planId && <button type="button" className="facing-small" onClick={() => void persistPlan(true)}>另存为新方案</button>}
        <button type="button" className="facing-small" disabled={!plan.description.trim()} onClick={() => void copyPlan()}>一键复制描述、地点与坐标</button>
      </div>
      <p className="fmap-note">一键复制去其他AI平台生成；带回按方案绘制的图片后，地点会按方案坐标自动落位。</p>
      {notice && <p role="status" className="fmap-note">{notice}</p>}
      <MapDimensions value={settings} onChange={patch => { setSettings({ ...settings, ...patch }); setCandidate(undefined); }} />
      {replacement && <>
        <label className="fmap-check"><input type="checkbox" checked={referenceOriginal} disabled={!!busy} onChange={event => { setReferenceOriginal(event.target.checked); setCandidate(undefined); }} />使用当前图块原图作参考</label>
        <div className="facing-pair"><label>替换后的地图宽度<input type="number" min={1} value={replacement.width} onChange={event => { setReplacement({ ...replacement, width: +event.target.value }); setCandidate(undefined); }} /></label>
          <label>替换后的地图高度<input type="number" min={1} value={replacement.height} onChange={event => { setReplacement({ ...replacement, height: +event.target.value }); setCandidate(undefined); }} /></label></div>
        <button type="button" className="facing-small" onClick={() => { setReplacement({ ...replacement, height: replacement.width * settings.height / settings.width }); setCandidate(undefined); }}>地图区域匹配图片比例</button>
        <p className="fmap-note">先预览生成结果，保存后替换所选图块。保留地点ID和内部地图，地点随区域尺寸同步调整。</p>
        <button type="button" className="facing-soft" disabled={!!busy || !plan.description.trim()} onClick={() => void saveTilePlan()}>保存描述、地点与区域</button>
      </>}
      {extension && <p className="fmap-note">使用相邻图块的边缘作为参考。保存时保留原图；请预览道路与河流是否衔接。</p>}
      <button type="button" className="facing-soft" disabled={!!busy || !plan.description.trim()} onClick={() => uploading.current?.click()}>上传已有地图</button>
      <p className="fmap-note">上传后先预览，点击确认应用，使用当前文字方案的地点清单与坐标，不调用图片API。</p>
      <button type="button" className="facing-primary" disabled={!!busy || !plan.description.trim()} onClick={() => void generateImage()}>确认生成地图 · 图片API</button>
      {candidate && <><img className="fmap-candidate" src={candidate.url} alt="地图候选图" />
        {candidate.extension && page && <MapExpansionPreview page={page} source={candidate.url} extension={candidate.extension} />}
        <div className="facing-pair"><button type="button" className="facing-primary" disabled={!!busy} onClick={() => void saveImage()}>{candidate.uploaded ? "确认应用已有地图" : candidate.replacement ? "保存并替换所选图块" : "保存并加入地图"}</button>
          <button type="button" className="facing-soft" disabled={!!busy} onClick={() => void run("下载原图", () => downloadFile(candidate.blob, "地图原图." + (candidate.blob.type.split("/")[1]?.replace("jpeg", "jpg") || "png")))}>下载原图</button></div>
      </>}
      {error && <p className="facing-error" role="alert">{error}</p>}
      </fieldset>
    </MapSheet>}
    {sheet === "edit" && placeDraft && <MapSheet title="编辑地点" onClose={closeSheet}>
      <label>地点名称<input value={placeDraft.name} onChange={event => setPlaceDraft({ ...placeDraft, name: event.target.value })} /></label>
      <label>地点介绍<textarea aria-label="地点介绍" value={placeDraft.description} onChange={event => setPlaceDraft({ ...placeDraft, description: event.target.value })} /></label>
      <div className="facing-pair">{(["x", "y"] as const).map(axis => <label key={axis}>{axis.toUpperCase()}<input type="number" value={Math.round(placeDraft[axis])}
        onChange={event => setPlaceDraft({ ...placeDraft, [axis]: +event.target.value })} /></label>)}</div>
      <button type="button" className="facing-primary" disabled={!!busy || !placeDraft.name.trim()} onClick={() => void savePlace()}>保存地点</button>
      {page?.places.some(place => place.id === placeDraft.id) && <button type="button" className="facing-link facing-delete" disabled={!!busy} onClick={() => void savePlace(true)}>删除地点及内部地图</button>}
    </MapSheet>}
    {sheet === "transfer" && <MapTransferSheet name={atlas?.name} selectedName={selected?.name} data={imported} asTemplate={importAsTemplate} busy={!!busy}
      onTemplate={setImportAsTemplate} onFile={file => void readImport(file)} onImport={() => void importMap()} onExport={place => void exportMap(place)} onClose={closeSheet} />}
    {sheet === "tiles" && page && atlas && <MapTileSheet page={page} selectedId={selectedTileId} busy={!!busy} onSelect={setSelectedTileId}
      onSave={(tile, order) => void saveTile(tile, order)} onRemove={(id, removePlaces) => void run("删除图块", async () => {
        setAtlas(await removeMapTile(atlas.id, page.id, id, removePlaces)); setSelectedTileId(undefined); setSelectedId(undefined); setSheet(null);
      })} onRegenerate={regenerate} onDrag={id => { setSelectedTileId(id); setSelectedId(undefined); setEditing(false); setTileEditing(true); setSheet(null); }}
      onDownload={tile => void run("下载原图", async () => {
        const url = await getThemeAssetDataUrl(tile.mediaId); if (!url) throw new Error("找不到原图。");
        const blob = await (await fetch(url)).blob(); await downloadFile(blob, `${tile.name || "地图图块"}.${blob.type.split("/")[1]?.replace("jpeg", "jpg") || "png"}`);
      })} onExpand={openGenerate} onCalibrate={() => void run("正在识图校准地点…", async signal => {
        const places = await calibrateFacingMap(character, page, signal);
        setAtlas(await saveMapPage(atlas.id, { ...page, places })); setSheet(null);
      })} onClose={closeSheet} />}
    {sheet === "animation" && <MapSheet title="移动动画" onClose={closeSheet}>
      <label>动画方式<select value={settings.animation} onChange={event => setSettings({ ...settings, animation: event.target.value as MapPreferences["animation"] })}>
        <option value="car">地图虚化 · 前往过场</option><option value="route">头像沿直线移动</option></select></label>
      <p className="fmap-note">头像从当前位置沿直线前往目的地，无需设置道路。跨地图时自动衔接各地图的入口。</p>
      <label>路线样式<select value={settings.line} onChange={event => setSettings({ ...settings, line: event.target.value as MapPreferences["line"] })}>
        <option value="dashed">虚线</option><option value="solid">实线</option></select></label>
      <label>动画时长（秒）<input type="number" min={1} max={30} value={settings.duration} onChange={event => setSettings({ ...settings, duration: Math.max(1, Math.min(30, +event.target.value || 1)) })} /></label>
      <button type="button" className="facing-primary" disabled={!!busy} onClick={() => void run("保存动画设置", async () => {
        await saveMapPreferences({ animation: settings.animation, line: settings.line, duration: settings.duration }); setSheet(null);
      })}>保存动画设置</button>
    </MapSheet>}
    {sheet === "history" && atlas && <MapSheet title="地图记录" onClose={closeSheet}>
      <div className="fmap-history-scroll" role="region" aria-label="地图历史记录" tabIndex={0}>
      <h3>角色动向</h3>
      <button type="button" className="facing-small" onClick={() => { setSnapshotId(undefined); setSheet(null); }}>查看最新动向</button>
      {[...atlas.snapshots].reverse().map(item => <button type="button" key={item.id} className="facing-soft" onClick={() => { setSnapshotId(item.id); setSheet(null); }}>
        {new Date(item.createdAt).toLocaleString("zh-CN")} · {item.entries.length}位角色</button>)}
      <h3>出行记录</h3>{[...atlas.visits].reverse().filter(item => item.identityId === identityId).map(item => <article className="fmap-visit" key={item.id} data-visit-id={item.id}>
        <div className="fmap-visit-row"><div><strong>{mapPlacePath(atlas, item.placeId)||"已移除的地点"}</strong><small>{new Date(item.at).toLocaleString("zh-CN")}{item.secret ? " · 偷偷前往" : ""}</small>
          <small>{item.characterIds.length?`与${item.characterIds.map(id=>characters.find(character=>character.id===id)?.name??"角色").join("、")}同行`:"独自前往"}</small></div>
          <button type="button" className="facing-small facing-delete" disabled={!!busy} aria-label={`删除出行记录到${mapPlacePath(atlas,item.placeId)||"已移除的地点"}`} onClick={()=>{setVisitDeleteId(item.id);setError("");}}>删除</button></div>
        {visitDeleteId===item.id&&<div className="fmap-visit-confirm" role="group" aria-label="删除出行记录">
          <p>删除这条出行记录、对应的到达消息及相关角色记忆？包含这些内容的长期、核心摘要也会移除。</p>
          <div className="facing-choices"><button type="button" className="facing-small facing-delete" disabled={!!busy} onClick={()=>void run("正在删除出行记录和记忆…",async()=>{
            setAtlas(await deleteMapVisitAndMemories(atlas.id,item.id,identityId));setVisitDeleteId(undefined);onRecordsChanged?.();
          })}>删除记录及相关记忆</button><button type="button" className="facing-small" disabled={!!busy} onClick={()=>{setVisitDeleteId(undefined);setError("");}}>取消</button></div>
          {error&&<p className="facing-error" role="alert">{error}</p>}
        </div>}
      </article>)}
      {!atlas.visits.some(item=>item.identityId===identityId)&&<p className="fmap-note">暂无出行记录</p>}
      <h3>邀请记录</h3>{[...atlas.invitations].reverse().filter(item => item.identityId === identityId).map(item => <button key={item.id} type="button" className="facing-soft"
        onClick={() => { setInvitationId(item.id); setSheet("invitations"); }}>
        {mapPlacePath(atlas, item.placeId)} · {new Date(item.createdAt).toLocaleString("zh-CN")}</button>)}
      </div>
    </MapSheet>}
    {sheet === "travel" && selected && atlas && <MapSheet title={companions.length ? "确认结伴前往" : "确认前往"} onClose={closeSheet}>
      <p>前往「{mapPlacePath(atlas, selected.id)}」？</p>
      {currentMeeting?.turns.length ? <p>保留当前对话记录，到达后继续；同行角色可以重新选择。</p> : null}
      {!!selectedActivities.filter(entry=>!companions.includes(entry.characterId)).length && <p>最近动向显示，{selectedActivities.filter(entry=>!companions.includes(entry.characterId)).map(entry => characters.find(item => item.id === entry.characterId)?.name).join("、")}在这里，可能会注意到你的到来。</p>}
      <fieldset><legend>同行角色（可多选）</legend>{travelMembers.map(item => <label key={item.id} className="fmap-check">
        <input type="checkbox" checked={companions.includes(item.id)} onChange={() => setCompanions(current=>toggle(current,item.id))} />{item.name}
      </label>)}</fieldset>
      {!!companions.length&&<p className="fmap-note">勾选的角色与你一起前往，不视为原本就在目的地。选择“去找他”时则按到访处理。</p>}
      {!companions.length && <label className="fmap-check"><input type="checkbox" checked={secret} onChange={event => setSecret(event.target.checked)} />偷偷前往，初始不让对方发现</label>}
      <button type="button" className="facing-primary" disabled={!!busy} onClick={() => beginTrip(companions)}>{companions.length ? `和${companions.map(id => characters.find(item => item.id === id)?.name).join("、")}直接一起去` : "确认前往"}</button>
      {!!companions.length && <button type="button" className="facing-soft" disabled={!!busy} onClick={() => void invite()}>发送邀请并等待回复 · 文字API</button>}
      {error && <p className="facing-error" role="alert">{error}</p>}
    </MapSheet>}
    {sheet === "invitations" && invitation && atlas && <MapSheet title="同行邀请" onClose={closeSheet}>
      <p>前往{mapPlacePath(atlas, invitation.placeId)}</p>
      {invitation.recipients.map(recipient => <div className="fmap-invite-result" key={recipient.characterId}>
        <strong>{characters.find(item => item.id === recipient.characterId)?.name} · {{ waiting: "等待回复", accepted: "已同意", declined: "已婉拒", failed: "未完成" }[recipient.status]}</strong>
        <p>{recipient.reply}</p>
        {(recipient.status === "failed" || recipient.status === "waiting") && !busy && <button type="button" className="facing-small" onClick={() => void retryInvitation(recipient.characterId)}>继续等待／重试 · 文字API</button>}
      </div>)}
      <button type="button" className="facing-primary" disabled={!!busy || invitation.recipients.some(item => item.status === "waiting")
        || !invitation.recipients.some(item => item.status === "accepted")} onClick={() => {
          setTargetCharacter(undefined); setSecret(false);
          beginTrip(invitation.recipients.filter(item => item.status === "accepted").map(item => item.characterId), invitation.placeId, true);
        }}>好的，和已同意的角色出发</button>
      {error && <p className="facing-error" role="alert">{error}</p>}
    </MapSheet>}
  </section>;
}
