"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, History, Map as MapIcon, Plus, RefreshCw, Settings2, X } from "lucide-react";
import type { Character } from "@/lib/character-types";
import { getCharacterWorldGroup } from "@/lib/character-world-storage";
import { loadChatScope } from "@/lib/chat-scope-storage";
import { facingId, type FacingMeeting } from "@/lib/facing-storage";
import { loadWorldBooks, resolveUserIdentity, loadApiConfigs, loadBindingConfig, resolveBinding } from "@/lib/settings-storage";
import { downloadFile } from "@/lib/download-utils";
import { getThemeAssetDataUrl } from "@/lib/theme-storage";
import { answerMapInvitation, calibrateFacingMap, extensionPosition, planFacingMap, refreshMapActivities, renderFacingMap,
  type MapExtension, type MapPlan } from "@/lib/facing-map-engine";
import { commitMapTile, createFacingAtlas, createMapInterior, loadFacingAtlases, loadFacingAtlas, loadMapPreferences,
  mapPlace, mapPlacePath, mapRoute, mapActivitySnapshot, mapBoundaryTile, placeOnMapPage, saveMapPage, saveMapPreferences, storeMapTile, updateFacingAtlas,
  type FacingAtlas, type MapPlace, type MapPoint, type MapPreferences, type MapTrip } from "@/lib/facing-map-storage";
import { FacingMapCanvas } from "./facing-map-canvas";
import { MapDimensions, MapSheet, MapExpansionPreview } from "./facing-map-panels";
import { MapTravel, type MapTravelAnimation } from "./facing-map-travel";

type Sheet = "create" | "sources" | "generate" | "edit" | "animation" | "history" | "travel" | "invitations" | "tiles" | null;
type MapCandidate = { blob: Blob; url: string; plan: MapPlan; extension?: MapExtension };
export function FacingMapApp({ character, characters, currentMeeting, onBack, onSettings, onArrive }: {
  character: Character; characters: Character[]; currentMeeting?: FacingMeeting;
  onBack: () => void; onSettings: () => void;
  onArrive: (atlas: FacingAtlas, trip: MapTrip, visitId: string) => Promise<void>;
}) {
  const world = getCharacterWorldGroup(character.id);
  const worldId = world?.id ?? character.id;
  const members = characters.filter(item => world?.memberIds.includes(item.id) ?? item.id === character.id);
  const [atlas, setAtlas] = useState<FacingAtlas | undefined>(() => loadFacingAtlases(worldId)[0]);
  const [pageId, setPageId] = useState(atlas?.pages[0]?.id);
  const [selectedId, setSelectedId] = useState<string>();
  const [sheet, setSheet] = useState<Sheet>(atlas ? null : "create");
  const [settings, setSettings] = useState(loadMapPreferences);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [mapName, setMapName] = useState(world?.name ?? "我的世界地图");
  const [characterIds, setCharacterIds] = useState(members.map(item => item.id));
  const [bookIds, setBookIds] = useState<string[]>([]);
  const [requirement, setRequirement] = useState("");
  const [plan, setPlan] = useState<MapPlan>({ description: "", places: [] });
  const [extension, setExtension] = useState<MapExtension>();
  const [candidate, setCandidate] = useState<MapCandidate>();
  const [placeDraft, setPlaceDraft] = useState<MapPlace>();
  const [editing, setEditing] = useState(false);
  const [road, setRoad] = useState<{ from: string; points: MapPoint[]; replacingId?: string }>();
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
  const invitation = atlas?.invitations.find(item => item.id === invitationId);
  const selectedActivities = atlas && selected && page ? (snapshot?.entries ?? []).filter(entry => placeOnMapPage(atlas, entry.placeId, page.id)?.id === selected.id) : [];
  const api = loadApiConfigs().find(item => item.id === resolveBinding(loadBindingConfig(), character.id, "facing").apiConfigId);
  const books = loadWorldBooks();

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => () => { if (candidate) URL.revokeObjectURL(candidate.url); }, [candidate]);
  function reload() { if (atlas) setAtlas(loadFacingAtlas(atlas.id) ?? undefined); }
  async function run(label: string, action: (signal: AbortSignal) => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    const control = new AbortController(); controller.current = control;
    setBusy(label); setError("");
    try { await action(control.signal); }
    catch (cause) { if (!control.signal.aborted) setError(cause instanceof Error ? cause.message : "操作失败，请重试。"); }
    finally { lock.current = false; controller.current = null; setBusy(""); }
  }
  function closeSheet() {
    if (busy) return;
    setSheet(null); setError("");
  }
  function toggle(list: string[], value: string) { return list.includes(value) ? list.filter(id => id !== value) : [...list, value]; }
  function openGenerate(direction?: MapExtension["direction"]) {
    if (!page) return;
    setExtension(direction && page.tiles.length ? { direction, tile: mapBoundaryTile(page, direction) } : undefined);
    setPlan({ description: page.parentPlaceId ? `绘制「${page.name}」的内部平面图，保留清晰的房间、设施和通道。` : "", places: [] });
    setCandidate(undefined); setRequirement(""); setError("");
    setSettings({ ...loadMapPreferences(), ...(page.parentPlaceId ? { width: 1536, height: 1152 } : {}) });
    setSheet("generate");
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
    setCharacterIds([...atlas.characterIds]); setBookIds([...atlas.worldBookIds]); setMapName(atlas.name); setSheet("sources");
  }
  async function saveSources() {
    if (!atlas || !mapName.trim()) return;
    await run("保存参考资料", async () => {
      setAtlas(await updateFacingAtlas(atlas.id, current => ({ ...current, name: mapName.trim(), characterIds, worldBookIds: bookIds })));
      setSheet(null);
    });
  }
  async function generatePlan() {
    if (!atlas || !page) return;
    await run("正在生成文字方案…", async signal => {
      const result = await planFacingMap(character, atlas, page, characters, requirement, settings, signal, extension);
      setPlan(result); setCandidate(undefined);
    });
  }
  async function generateImage() {
    if (!plan.description.trim() || !atlas || !page) { setError("请先生成或填写地图描述。"); return; }
    await run("正在生成地图图片…", async signal => {
      const savedPlan = { ...plan, places: plan.places.map(place => ({ ...place })) };
      const result = await renderFacingMap(character, savedPlan, settings, signal, extension);
      if (!signal.aborted) setCandidate({ blob: result.blob, url: URL.createObjectURL(result.blob), plan: savedPlan, extension });
    });
  }
  async function saveImage() {
    if (!atlas || !page || !candidate) return;
    await run("保存地图图片", async () => {
      const tile = await storeMapTile(candidate.blob, { x: 0, y: 0 });
      const position = extensionPosition(candidate.extension?.tile, candidate.extension?.direction ?? "right", tile.width, tile.height);
      Object.assign(tile, position);
      const newPlaces = candidate.plan.places.map(place => ({ ...place, id: facingId(),
        x: tile.x + place.x / 1000 * tile.width, y: tile.y + place.y / 1000 * tile.height }));
      setAtlas(await commitMapTile(atlas.id, page.id, tile, newPlaces, candidate.plan.description));
      setSheet(null); setCandidate(undefined); setSelectedId(undefined);
    });
  }
  async function upload(file: File) {
    if (!atlas || !page) return;
    await run("保存原始地图", async () => {
      const tile = await storeMapTile(file, { x: 0, y: 0 });
      if (page.tiles.length) Object.assign(tile, extensionPosition(mapBoundaryTile(page, "right"), "right", tile.width, tile.height));
      setAtlas(await commitMapTile(atlas.id, page.id, tile, [], page.description));
      setSheet(null);
    });
  }
  async function selectPlace(id: string) {
    if (!atlas || !page) return;
    if (road) {
      if (road.from === id) { setError("请选择另一处地点作为道路终点。"); return; }
      const saved = { ...page, roads: [...page.roads.filter(item => item.id !== road.replacingId),
        { id: road.replacingId ?? facingId(), from: road.from, to: id, points: road.points }] };
      await run("保存道路", async () => { setAtlas(await saveMapPage(atlas.id, saved)); setRoad(undefined); });
    }
    setSelectedId(id);
  }
  function addPoint(point: MapPoint) {
    if (road) setRoad({ ...road, points: [...road.points, point] });
    else if (editing) {
      setPlaceDraft({ ...point, id: facingId(), name: "", description: "" }); setSheet("edit");
    } else setSelectedId(undefined);
  }
  async function movePlace(id: string, point: MapPoint) {
    if (!atlas || !page || busy) return;
    await run("保存位置", async () => {
      const fresh = loadFacingAtlas(atlas.id)?.pages.find(item => item.id === page.id) ?? page;
      setAtlas(await saveMapPage(atlas.id, { ...fresh, places: fresh.places.map(place => place.id === id ? { ...place, ...point } : place) }));
    });
  }
  async function savePlace(remove = false) {
    if (!atlas || !page || !placeDraft || (!remove && !placeDraft.name.trim())) return;
    await run("保存地点", async () => {
      setAtlas(await updateFacingAtlas(atlas.id, current => {
        const removed = new Set(remove ? [placeDraft.id] : []);
        if (remove) for (let previous = -1; previous !== removed.size;) {
          previous = removed.size;
          for (const interior of current.pages.filter(item => item.parentPlaceId && removed.has(item.parentPlaceId))) {
            interior.places.forEach(place => removed.add(place.id));
          }
        }
        return { ...current,
          userPlaces: Object.fromEntries(Object.entries(current.userPlaces).filter(([, id]) => !removed.has(id))),
          pages: current.pages.filter(item => !item.parentPlaceId || !removed.has(item.parentPlaceId)).map(item => {
            const places = item.id !== page.id ? item.places : remove ? item.places.filter(place => place.id !== placeDraft.id) :
              item.places.some(place => place.id === placeDraft.id) ? item.places.map(place => place.id === placeDraft.id ? { ...placeDraft, name: placeDraft.name.trim() } : place)
              : [...item.places, { ...placeDraft, name: placeDraft.name.trim() }];
            return { ...item, places, roads: item.roads.filter(road => !removed.has(road.from) && !removed.has(road.to)) };
          }) };
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
  async function refresh() {
    if (!atlas) return;
    await run("正在读取记忆并刷新动向…", async signal => {
      const result = await refreshMapActivities(character, atlas, characters, signal);
      setAtlas(await updateFacingAtlas(atlas.id, current => ({ ...current, snapshots: [...current.snapshots, result] })));
      setSnapshotId(undefined);
    });
  }
  function prepareTrip(targetId?: string) {
    if (targetId) setCompanions([]);
    setTargetCharacter(targetId); setSecret(false); setError(""); setSheet("travel");
  }
  function beginTrip(characterIds: string[], placeId = selectedId, invited = false) {
    if (!atlas || !page || !placeId) return;
    const destination = placeOnMapPage(atlas, placeId, page.id);
    const source = userPlaceId ? placeOnMapPage(atlas, userPlaceId, page.id) : undefined;
    const path = source && destination ? mapRoute(page, source.id, destination.id) : undefined;
    let disconnected = false;
    const paths = path ? [{ points: path }, ...characterIds.map(id => {
      const member = characters.find(item => item.id === id);
      const activity = snapshot?.entries.find(item => item.characterId === id);
      const memberPlace = activity ? placeOnMapPage(atlas, activity.placeId, page.id) : source;
      const memberPath = memberPlace && destination ? mapRoute(page, memberPlace.id, destination.id) : path;
      if (!memberPath) disconnected = true;
      return { character: member, points: memberPath ?? [] };
    })] : [];
    if (settings.animation === "route" && (!path || disconnected)) { setError("当前位置到目的地尚未连通道路。请先设置我的位置和道路，或在动画设置中选择前往过场。"); return; }
    setVisitId(facingId()); setProgress(0); setSheet(null);
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
  const roadPoints = road && page ? [page.places.find(place => place.id === road.from)!, ...road.points].filter(Boolean) : undefined;
  return <section className="fmap-app">
    <header className="facing-header">
      <button type="button" className="facing-back" aria-label="返回" disabled={!!busy || !!animation} onClick={() => {
        if (page?.parentPlaceId && atlas) { setPageId(mapPlace(atlas, page.parentPlaceId)?.page.id); setSelectedId(undefined); setRoad(undefined); }
        else onBack();
      }}><ChevronLeft size={22} /></button>
      <div className="fmap-heading"><h1>{sceneTitle}</h1><small>{world?.name ?? "当前世界"}</small></div>
      <button type="button" className="facing-icon" aria-label="地图设置" disabled={!!busy || !!animation} onClick={onSettings}><Settings2 size={20} /></button>
    </header>
    {atlas && page ? <>
      <div className="fmap-toolbar">
        <select aria-label="选择地图" value={atlas.id} disabled={!!busy || !!animation} onChange={event => {
          const next = loadFacingAtlas(event.target.value);
          if (next) { setAtlas(next); setPageId(next.pages[0]?.id); setSelectedId(undefined); setRoad(undefined); setSnapshotId(undefined); }
        }}>{loadFacingAtlases(worldId).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <button type="button" className="facing-small" disabled={!!busy || !!animation} onClick={() => setSheet("create")}><Plus size={14} />新建</button>
        <button type="button" className="facing-small" disabled={!!busy || !!animation} onClick={() => setEditing(!editing)} aria-pressed={editing}>{editing ? "完成编辑" : "编辑地图"}</button>
      </div>
      <div className="fmap-stage" data-blurred={animation?.mode === "car" ? "true" : undefined}>
        <FacingMapCanvas atlas={atlas} page={page} characters={characters} snapshot={snapshot} selectedId={selectedId}
          userPlaceId={userPlaceId} userAvatar={identity?.avatarUrl} userName={identity?.name ?? "你"}
          editing={editing && !busy && !animation} road={roadPoints}
          travel={animation?.mode === "route" ? { paths: animation.paths, progress, dashed: settings.line === "dashed" } : undefined}
          onPlace={id => { if (!busy && !animation) void selectPlace(id); }} onPoint={point => { if (!busy && !animation) addPoint(point); }}
          onRoadMove={(index, point) => { if (road) setRoad({ ...road, points: road.points.map((value, position) => position === index ? point : value) }); }}
          onMove={(id, point) => void movePlace(id, point)} />
      </div>
      {road && <div className="fmap-road-hint">依次点道路转折点，再点终点保存。
        <button type="button" onClick={() => setRoad({ ...road, points: road.points.slice(0, -1) })}>撤回一点</button>
        <button type="button" onClick={() => setRoad(undefined)}>取消</button></div>}
      {selected && !animation && <div className="fmap-detail">
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
          <button type="button" className="facing-small" disabled={!!busy} onClick={() => void interior()}>进入内部地图</button>
          <button type="button" className="facing-primary" disabled={!!busy} onClick={() => prepareTrip()}>前往这里</button>
          {editing && <>
            <button type="button" className="facing-small" onClick={() => { setPlaceDraft({ ...selected }); setSheet("edit"); }}>编辑地点</button>
            <button type="button" className="facing-small" onClick={() => { setRoad({ from: selected.id, points: [] }); setSelectedId(undefined); }}>从这里画道路</button>
            <button type="button" className="facing-small" onClick={() => void run("设置当前位置", async () => {
              setAtlas(await updateFacingAtlas(atlas.id, current => ({ ...current, userPlaces: { ...current.userPlaces, [identityKey]: selected.id } })));
            })}>设为我的位置</button>
          </>}
        </div>
      </div>}
      {!animation && <footer className="fmap-footer">
        {editing && <p className="fmap-note">轻点空白处添加地点；拖动标记调整位置。</p>}
        <div className="facing-choices">
          <button type="button" className="facing-small" disabled={!!busy} onClick={() => openGenerate()}>生成地图</button>
          <button type="button" className="facing-small" disabled={!!busy} onClick={editSources}>参考资料</button>
          <button type="button" className="facing-small" disabled={!!busy} onClick={() => uploading.current?.click()}>上传图片</button>
          <button type="button" className="facing-small" disabled={!!busy} onClick={() => setSheet("tiles")}>图块与扩展</button>
          <button type="button" className="facing-small" disabled={!!busy} onClick={() => { setSettings(loadMapPreferences()); setSheet("animation"); }}>前往动画</button>
          <button type="button" className="facing-small" disabled={!!busy || !page.places.length} onClick={() => void refresh()}><RefreshCw size={13} />刷新动向 · 文字API</button>
          <button type="button" className="facing-small" disabled={!!busy} onClick={() => setSheet("history")}><History size={13} />历史</button>
        </div>
        {snapshot && <small>{snapshotId ? "正在查看历史动向" : "最近刷新"} · {new Date(snapshot.createdAt).toLocaleString("zh-CN")}</small>}
      </footer>}
      {animation && <MapTravel animation={animation} duration={settings.duration} destination={mapPlacePath(atlas, animation.trip.placeId)}
        characters={characters} userName={identity?.name ?? "你"} userAvatar={identity?.avatarUrl} onProgress={setProgress} onArrive={arrive} onCancel={() => setAnimation(undefined)} />}
    </> : <div className="facing-home-empty"><MapIcon size={42} /><p>为这个世界创建一张地图</p><button className="facing-primary" onClick={() => setSheet("create")}>创建地图</button></div>}
    {busy && <div className="fmap-busy" role="status">{busy}<button type="button" onClick={() => controller.current?.abort()}>停止</button></div>}
    {error && <p className="facing-error fmap-error" role="alert">{error}</p>}
    <input ref={uploading} type="file" hidden accept="image/*" onChange={event => {
      const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void upload(file);
    }} />
    {(sheet === "create" || sheet === "sources") && <MapSheet title={sheet === "create" ? "创建世界地图" : "地图参考资料"} onClose={closeSheet}>
      <label>地图名称<input value={mapName} onChange={event => setMapName(event.target.value)} /></label>
      <fieldset><legend>参考角色（可多选）</legend>{members.map(item => <label key={item.id} className="fmap-check">
        <input type="checkbox" checked={characterIds.includes(item.id)} onChange={() => setCharacterIds(toggle(characterIds, item.id))} />{item.name}
      </label>)}</fieldset>
      <fieldset><legend>参考世界书（可多选）</legend>{books.map(book => <label key={book.id} className="fmap-check">
        <input type="checkbox" checked={bookIds.includes(book.id)} onChange={() => setBookIds(toggle(bookIds, book.id))} />{book.name}
      </label>)}{!books.length && <p>暂无世界书</p>}</fieldset>
      <p className="fmap-note">创建后可上传底图，或逐步生成文字方案和地图图片。</p>
      <button type="button" className="facing-primary" disabled={!!busy} onClick={() => void (sheet === "create" ? create() : saveSources())}>{sheet === "create" ? "创建并打开" : "保存参考资料"}</button>
    </MapSheet>}
    {sheet === "generate" && <MapSheet title={extension ? "扩展地图" : "生成地图"} onClose={closeSheet}>
      <label>补充要求<textarea aria-label="补充要求" value={requirement} onChange={event => setRequirement(event.target.value)} placeholder="描述这个世界的范围或想增加的区域。" /></label>
      <button type="button" className="facing-soft" disabled={!!busy} onClick={() => void generatePlan()}>生成文字方案 · {api?.defaultModel ?? "请配置文字API"}</button>
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
      <MapDimensions value={settings} onChange={patch => { setSettings({ ...settings, ...patch }); setCandidate(undefined); }} />
      {extension && <p className="fmap-note">使用相邻图块的边缘作为参考。保存时保留原图；请预览道路与河流是否衔接。</p>}
      <button type="button" className="facing-primary" disabled={!!busy || !plan.description.trim()} onClick={() => void generateImage()}>确认生成地图 · 图片API</button>
      {candidate && <><img className="fmap-candidate" src={candidate.url} alt="地图候选图" />
        {candidate.extension && page && <MapExpansionPreview page={page} source={candidate.url} extension={candidate.extension} />}
        <div className="facing-pair"><button type="button" className="facing-primary" disabled={!!busy} onClick={() => void saveImage()}>保存并加入地图</button>
          <button type="button" className="facing-soft" disabled={!!busy} onClick={() => void run("下载原图", () => downloadFile(candidate.blob, "地图原图." + (candidate.blob.type.split("/")[1]?.replace("jpeg", "jpg") || "png")))}>下载原图</button></div>
      </>}
      {error && <p className="facing-error" role="alert">{error}</p>}
    </MapSheet>}
    {sheet === "edit" && placeDraft && <MapSheet title="编辑地点" onClose={closeSheet}>
      <label>地点名称<input value={placeDraft.name} onChange={event => setPlaceDraft({ ...placeDraft, name: event.target.value })} /></label>
      <label>地点介绍<textarea aria-label="地点介绍" value={placeDraft.description} onChange={event => setPlaceDraft({ ...placeDraft, description: event.target.value })} /></label>
      <div className="facing-pair">{(["x", "y"] as const).map(axis => <label key={axis}>{axis.toUpperCase()}<input type="number" value={Math.round(placeDraft[axis])}
        onChange={event => setPlaceDraft({ ...placeDraft, [axis]: +event.target.value })} /></label>)}</div>
      <button type="button" className="facing-primary" disabled={!!busy || !placeDraft.name.trim()} onClick={() => void savePlace()}>保存地点</button>
      {page?.places.some(place => place.id === placeDraft.id) && <button type="button" className="facing-link facing-delete" disabled={!!busy} onClick={() => void savePlace(true)}>删除地点及内部地图</button>}
    </MapSheet>}
    {sheet === "tiles" && page && atlas && <MapSheet title="图块与扩展" onClose={closeSheet}>
      <div className="facing-choices">{(["left", "right", "top", "bottom"] as const).map(direction => <button key={direction} type="button" className="facing-small"
        disabled={!!busy || !page.tiles.length} onClick={() => openGenerate(direction)}>向{{ left: "左", right: "右", top: "上", bottom: "下" }[direction]}扩展</button>)}</div>
      {page.tiles.map((tile, index) => <button key={tile.id} type="button" className="facing-soft" disabled={!!busy} onClick={() => void run("下载原图", async () => {
        const url = await getThemeAssetDataUrl(tile.mediaId); if (!url) throw new Error("找不到原图。");
        const blob = await (await fetch(url)).blob(); await downloadFile(blob, `地图图块-${index + 1}.${blob.type.split("/")[1]?.replace("jpeg", "jpg") || "png"}`);
      })}>图块 {index + 1} · {tile.pixelWidth} × {tile.pixelHeight} · 下载原图</button>)}
      <button type="button" className="facing-soft" disabled={!!busy || !page.places.length || !page.tiles.length}
        onClick={() => void run("正在识图校准地点…", async signal => {
          const places = await calibrateFacingMap(character, page, signal);
          setAtlas(await saveMapPage(atlas.id, { ...page, places })); setSheet(null);
        })}>AI 校准地点 · 识图API</button>
      {editing && page.roads.map((item, index) => <div className="facing-row" key={item.id}>
        <span>道路 {index + 1} · {page.places.find(place => place.id === item.from)?.name} — {page.places.find(place => place.id === item.to)?.name}</span>
        <button type="button" className="facing-small" disabled={!!busy} onClick={() => { setRoad({ from: item.from, points: [...item.points], replacingId: item.id }); setSheet(null); }}>以此重画</button>
        <button type="button" className="facing-small facing-delete" disabled={!!busy} onClick={() => void run("删除道路", async () =>
          setAtlas(await saveMapPage(atlas.id, { ...page, roads: page.roads.filter(road => road.id !== item.id) })))}>删除</button>
      </div>)}
      {error && <p className="facing-error" role="alert">{error}</p>}
    </MapSheet>}
    {sheet === "animation" && <MapSheet title="前往动画" onClose={closeSheet}>
      <label>动画方式<select value={settings.animation} onChange={event => setSettings({ ...settings, animation: event.target.value as MapPreferences["animation"] })}>
        <option value="car">地图虚化 · 前往过场</option><option value="route">沿已设道路移动</option></select></label>
      <label>路线样式<select value={settings.line} onChange={event => setSettings({ ...settings, line: event.target.value as MapPreferences["line"] })}>
        <option value="dashed">虚线</option><option value="solid">实线</option></select></label>
      <label>动画时长（秒）<input type="number" min={1} max={30} value={settings.duration} onChange={event => setSettings({ ...settings, duration: Math.max(1, Math.min(30, +event.target.value || 1)) })} /></label>
      <button type="button" className="facing-primary" disabled={!!busy} onClick={() => void run("保存动画设置", async () => {
        await saveMapPreferences({ animation: settings.animation, line: settings.line, duration: settings.duration }); setSheet(null);
      })}>保存动画设置</button>
    </MapSheet>}
    {sheet === "history" && atlas && <MapSheet title="地图记录" onClose={closeSheet}>
      <h3>角色动向</h3>
      <button type="button" className="facing-small" onClick={() => { setSnapshotId(undefined); setSheet(null); }}>查看最新动向</button>
      {[...atlas.snapshots].reverse().map(item => <button type="button" key={item.id} className="facing-soft" onClick={() => { setSnapshotId(item.id); setSheet(null); }}>
        {new Date(item.createdAt).toLocaleString("zh-CN")} · {item.entries.length}位角色</button>)}
      <h3>出行记录</h3>{[...atlas.visits].reverse().filter(item => item.identityId === identityId).map(item => <p key={item.id}>
        {new Date(item.at).toLocaleString("zh-CN")} · {mapPlacePath(atlas, item.placeId)}{item.secret ? " · 偷偷前往" : ""}</p>)}
      <h3>邀请记录</h3>{[...atlas.invitations].reverse().filter(item => item.identityId === identityId).map(item => <button key={item.id} type="button" className="facing-soft"
        onClick={() => { setInvitationId(item.id); setSheet("invitations"); }}>
        {mapPlacePath(atlas, item.placeId)} · {new Date(item.createdAt).toLocaleString("zh-CN")}</button>)}
    </MapSheet>}
    {sheet === "travel" && selected && atlas && <MapSheet title={companions.length ? "确认结伴前往" : "确认前往"} onClose={closeSheet}>
      <p>前往「{mapPlacePath(atlas, selected.id)}」？</p>
      {currentMeeting?.turns.length ? <p>将保存并暂时结束当前对话，前往这里。</p> : null}
      {!!selectedActivities.length && <p>最近动向显示，{selectedActivities.map(entry => characters.find(item => item.id === entry.characterId)?.name).join("、")}在这里，可能会注意到你的到来。</p>}
      <fieldset><legend>同行角色（可多选）</legend>{members.map(item => <label key={item.id} className="fmap-check">
        <input type="checkbox" checked={companions.includes(item.id)} onChange={() => setCompanions(toggle(companions, item.id))} />{item.name}
      </label>)}</fieldset>
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
