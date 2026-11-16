"use client";

import { useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, History, Images, PanelsTopLeft, Plus, ScanLine, Settings2, UserRound, X } from "lucide-react";
import { loadCharacters } from "@/lib/character-storage";
import type { Character } from "@/lib/character-types";
import { createFacingMeeting, FACING_PARTS, facingId, loadFacingAssets, loadFacingMeetings, loadFacingSettings, saveFacingSettings,
  type FacingAsset, type FacingCharacterSettings, type FacingHotspot, type FacingMeeting } from "@/lib/facing-storage";
import { resolveUserIdentity } from "@/lib/settings-storage";
import { unlockAudioPlayback } from "@/lib/tts-service";
import { FacingAssets, FacingAssetTile } from "./facing-assets";
import { FacingRoom } from "./facing-room";
import { FacingStage } from "./facing-stage";

type Page = "home" | "room" | "settings" | "assets" | "hotspots" | "records" | "record";
type Sheet = "characters" | "scene" | "end" | null;

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
      <h2 className="facing-record-title">{record.title}</h2>
      <div className="facing-record-meta">{character.name} · {RECORD_TABS[record.type]} · {new Date(record.updatedAt).toLocaleString("zh-CN")}</div>
      <ol className="facing-turns">
        {record.turns.map(turn => <li key={turn.id} data-role={turn.role}>
          <small>{turn.role === "assistant" ? character.name : "你"} · {turn.sceneName}{turn.kind === "voice" ? " · 语音转写" : ""}</small>
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
  const [page, setPage] = useState<Page>("home");
  const [sheet, setSheet] = useState<Sheet>(() => !character && characters.length ? "characters" : null);
  const [settingOrigin, setSettingOrigin] = useState<"home" | "room">("home");
  const [category, setCategory] = useState<FacingAsset["category"]>("portrait");
  const [sceneOrigin, setSceneOrigin] = useState<"home" | "room">("home");
  const [assetOrigin, setAssetOrigin] = useState<"settings" | "home">("settings");
  const [meeting, setMeeting] = useState<FacingMeeting>();
  const [roomScene, setRoomScene] = useState<string>();
  const [roomPortrait, setRoomPortrait] = useState<string>();
  const [record, setRecord] = useState<FacingMeeting>();
  const [recordType, setRecordType] = useState<FacingMeeting["type"]>("main");
  const [error, setError] = useState("");
  const [assets, setAssets] = useState(() => character ? loadFacingAssets(character.id) : []);
  const current = character ? preferences.characters[character.id] ?? {} : {};
  const useScene = current.useScene !== false;
  const identityId = character ? resolveUserIdentity(character.id, "facing")?.id ?? null : null;
  const layeredPortrait = assets.find(item => item.id === current.portraitId && item.use === "idle");
  const fullPortrait = assets.find(item => item.id === current.fullPortraitId && item.use === "idle");
  const portrait = useScene ? layeredPortrait : fullPortrait ?? layeredPortrait;
  const scene = useScene ? assets.find(item => item.id === current.sceneId && item.category === "scene") : undefined;
  const savedRoomPortrait = assets.find(item => item.id === roomPortrait && item.use === "idle");
  const activePortrait = savedRoomPortrait && (savedRoomPortrait.composition === "full") === !useScene ? savedRoomPortrait : portrait;
  const activeScene = useScene ? assets.find(item => item.id === roomScene && item.category === "scene") : undefined;
  const usesFullPortrait = activePortrait ? activePortrait.composition === "full" : !useScene;
  const reactions = assets.filter(item => item.use === "reaction" && (item.composition === "full") === usesFullPortrait &&
    (!item.location || !activePortrait?.location || item.location === activePortrait.location));
  const scenes = assets.filter(item => item.category === "scene");
  const records = page === "records" && character ? loadFacingMeetings(character.id, identityId).filter(item => item.type === recordType) : [];
  const currentPortrait = settingOrigin === "room" && meeting ? activePortrait : portrait;
  const currentScene = settingOrigin === "room" && meeting ? activeScene : scene;

  async function selectCharacter(id: string) {
    setError("");
    try { setPreferences(await saveFacingSettings(id)); setAssets(loadFacingAssets(id)); setSheet(null); }
    catch { setError("角色选择保存失败。"); }
  }

  async function changeSetting(patch: Partial<FacingCharacterSettings>) {
    if (character) setPreferences(await saveFacingSettings(character.id, patch));
  }

  function commitSetting(patch: Partial<FacingCharacterSettings>) {
    setError("");
    void changeSetting(patch).catch(() => setError("设置保存失败。"));
  }

  function openAssets(from: "settings" | "home", type: FacingAsset["category"]) {
    setAssetOrigin(from);
    setCategory(type);
    setPage("assets");
  }

  function openRoom(item: FacingMeeting) {
    unlockAudioPlayback();
    const last = item.turns.at(-1);
    setMeeting(item);
    setRoomScene(last && last.useScene !== false ? last.sceneId : current.sceneId);
    setRoomPortrait(last ? last.portraitId : portrait?.id);
    setRecordType(item.type);
    setPage("room");
  }

  function newMeeting(type: FacingMeeting["type"], parent?: FacingMeeting) {
    if (character) openRoom(createFacingMeeting(character.id, identityId, type, parent));
  }

  function openSettings(origin: "home" | "room") {
    setSettingOrigin(origin);
    setPage("settings");
  }

  function openScene(origin: "home" | "room") {
    setSceneOrigin(origin);
    setSheet("scene");
  }

  function sceneSelected(id?: string) {
    if (sceneOrigin === "room") {
      setRoomScene(id);
      if (!useScene) commitSetting({ useScene: true });
    } else commitSetting({ sceneId: id, useScene: true });
    setSheet(null);
  }

  return <div className="facing-app">
    {page === "home" && <>
      <Header title="面对面" onBack={onClose}>
        {character && <button type="button" className="facing-icon" onClick={() => openSettings("home")} aria-label="设置"><Settings2 size={20} /></button>}
      </Header>
      {character ? <>
        <div className="facing-home-stage">
          <FacingStage portrait={portrait} scene={scene} name={character.name} fallback={character.avatar}>
            <div className="facing-home-label"><small>{useScene ? scene?.name ?? "默认场景" : portrait?.location ?? "不使用场景"}</small><strong>{character.name}</strong></div>
          </FacingStage>
        </div>
        <footer className="facing-home-actions">
          {!(useScene ? portrait : fullPortrait) && <button type="button" className="facing-link" onClick={() => openAssets("home", "portrait")}><Images size={16} />{useScene ? "设置立绘" : "设置完整画面"}</button>}
          <div className="facing-pair">
            <button type="button" className="facing-soft" onClick={() => setSheet("characters")}><UserRound size={17} />换角色</button>
            <button type="button" className="facing-soft" onClick={() => openScene("home")}><PanelsTopLeft size={17} />换场景</button>
          </div>
          <button type="button" className="facing-primary" onClick={() => newMeeting("main")}>开始面对面<ChevronRight size={18} /></button>
          <button type="button" className="facing-link" onClick={() => { setRecordType("main"); setPage("records"); }}><History size={16} />见面记录</button>
        </footer>
      </> : <div className="facing-home-empty"><UserRound size={48} strokeWidth={1.2} />
        <button type="button" className="facing-primary" onClick={() => setSheet("characters")} disabled={!characters.length}>选择角色</button>
        {!characters.length && <p>先在角色库里添加一位角色。</p>}
      </div>}
    </>}
    {page === "room" && character && meeting && <FacingRoom key={meeting.id} character={character} meeting={meeting} settings={current}
      portrait={activePortrait} scene={activeScene} reactions={reactions} onMeeting={setMeeting}
      onScene={() => openScene("room")} onSettings={() => openSettings("room")} onEnd={() => setSheet("end")}
      onVoice={value => commitSetting({ voice: value })} />}
    {page === "settings" && character && <>
      <Header title="角色设置" onBack={() => setPage(settingOrigin)} />
      <main className="facing-scroll facing-form">
        <h2 className="facing-record-title">{character.name}</h2>
        <div className="facing-list">
          <button type="button" onClick={() => openAssets("settings", "portrait")}><Images size={18} /><span>立绘与场景</span><ChevronRight size={17} /></button>
          <button type="button" onClick={() => setPage("hotspots")}><ScanLine size={18} /><span>虚拟体感</span><ChevronRight size={17} /></button>
        </div>
        <div className="facing-list facing-settings-list">
          <label>使用场景<input type="checkbox" role="switch" checked={useScene} onChange={event => commitSetting({ useScene: event.target.checked })} /></label>
          <label>回复长度<select value={current.length ?? "short"} onChange={event => commitSetting({ length: event.target.value as FacingCharacterSettings["length"] })}>
            <option value="short">简短</option><option value="normal">自然</option><option value="expanded">展开</option>
          </select></label>
          <label>角色语音<input type="checkbox" role="switch" checked={current.voice !== false} onChange={event => commitSetting({ voice: event.target.checked })} /></label>
          <label>启用触碰区域<input type="checkbox" role="switch" checked={current.touch !== false} onChange={event => commitSetting({ touch: event.target.checked })} /></label>
          <label>参考角色记忆<input type="checkbox" role="switch" checked={current.memory !== false} onChange={event => commitSetting({ memory: event.target.checked })} /></label>
        </div>
      </main>
    </>}
    {page === "assets" && character && <FacingAssets key={character.id} character={character} assets={assets} settings={current}
      initialCategory={category} onBack={() => setPage(assetOrigin)} onChange={() => { setAssets(loadFacingAssets(character.id)); }}
      onSelect={async asset => {
        await changeSetting(asset.category === "scene" ? { sceneId: asset.id, useScene: true }
          : asset.composition === "full" ? { fullPortraitId: asset.id, useScene: false } : { portraitId: asset.id, useScene: true });
        if (assetOrigin === "settings" && settingOrigin === "room") {
          if (asset.category === "scene") setRoomScene(asset.id);
          else setRoomPortrait(asset.id);
        }
      }} />}
    {page === "hotspots" && character && <HotspotEditor character={character} portrait={currentPortrait} scene={currentScene}
      points={current.hotspots?.[currentPortrait?.id ?? "avatar"] ?? []} onBack={() => setPage("settings")} onSave={async points => {
        await changeSetting({ hotspots: { ...current.hotspots, [currentPortrait?.id ?? "avatar"]: points } });
        setPage("settings");
      }} />}
    {page === "records" && character && <>
      <Header title="见面记录" onBack={() => setPage("home")} />
      <main className="facing-scroll facing-form">
        <div className="facing-segments" role="group" aria-label="记录分类">
          {Object.entries(RECORD_TABS).map(([key, label]) => <button type="button" key={key} aria-pressed={recordType === key}
            onClick={() => setRecordType(key as FacingMeeting["type"])}>{label}</button>)}
        </div>
        <div className="facing-row"><span>{character.name}</span><button type="button" className="facing-small" onClick={() => newMeeting("independent")}><Plus size={16} />新开独立见面</button></div>
        <div className="facing-list">
          {records.map(item =>
            <button type="button" key={item.id} onClick={() => { setRecord(item); setPage("record"); }}>
              <span className="facing-record-row"><strong>{item.title}</strong>
                <small>{item.turns.at(-1)?.sceneName} · {new Date(item.updatedAt).toLocaleDateString("zh-CN")}</small></span><ChevronRight size={17} />
            </button>)}
          {!records.length &&
            <p className="facing-empty">暂无{RECORD_TABS[recordType]}见面记录</p>}
        </div>
      </main>
    </>}
    {page === "record" && character && record && <MeetingTranscript record={record} character={character}
      onBack={() => setPage("records")} onContinue={() => openRoom(record)} onFork={() => newMeeting("branch", record)} />}
    {sheet === "characters" && <FacingSheet title="选择角色" close={() => setSheet(null)}>
      <div className="facing-list">
        {characters.map(item => <button type="button" key={item.id} onClick={() => void selectCharacter(item.id)}>
          <span className="facing-character-avatar">{item.avatar ? <img alt="" src={item.avatar} /> : <UserRound size={19} />}</span>
          <span>{item.name}</span>{item.id === character?.id && <small>当前</small>}
        </button>)}
      </div>
    </FacingSheet>}
    {sheet === "scene" && <FacingSheet title="更换场景" close={() => setSheet(null)}>
      <div className="facing-list">
        <button type="button" onClick={() => { commitSetting({ useScene: false }); setSheet(null); }}>
          <span>不使用场景</span>{!useScene && <small>当前</small>}
        </button>
      </div>
      {scenes.length > 0 && <div className="facing-grid">{scenes.map(item => <FacingAssetTile key={item.id} asset={item} onClick={() => sceneSelected(item.id)} />)}</div>}
      <div className="facing-pair">
        <button type="button" className="facing-soft" onClick={() => sceneSelected()}>默认场景</button>
        {sceneOrigin === "home"
          ? <button type="button" className="facing-primary" onClick={() => { setSheet(null); openAssets("home", "scene"); }}>设置场景</button>
          : <button type="button" className="facing-soft" onClick={() => { setSheet(null); openSettings("room"); }}>角色设置</button>}
      </div>
    </FacingSheet>}
    {sheet === "end" && <FacingSheet title="结束这次见面？" center close={() => setSheet(null)}>
      <div className="facing-pair"><button type="button" className="facing-soft" onClick={() => setSheet(null)}>继续</button>
        <button type="button" className="facing-primary" onClick={() => { setMeeting(undefined); setSheet(null); setPage("home"); }}>结束</button></div>
    </FacingSheet>}
    {error && <p className="facing-global-error" role="alert">{error}</p>}
  </div>;
}
