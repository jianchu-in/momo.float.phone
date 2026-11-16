"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, ChevronRight, ImagePlus, Plus, Sparkles, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/modal";
import type { Character } from "@/lib/character-types";
import { loadDwellingLayout } from "@/lib/dwelling-storage";
import { facingFullImageInstruction, polishFacingImageDescription } from "@/lib/facing-engine";
import { FACING_IMAGE_LOCATIONS, FACING_MEDIA_ACCEPT, FACING_REACTIONS, facingAssetLocation, facingAssetMood, facingId, facingMediaType, saveFacingAsset, updateFacingAsset,
  type FacingAsset, type FacingSceneGroup } from "@/lib/facing-storage";
import { generateImageFromConfiguredApi, resolveConfiguredImageGenerationSettings } from "@/lib/image-generation-service";
import { loadMediaBlob } from "@/lib/media-cache-storage";
import { getThemeAssetDataUrl } from "@/lib/theme-storage";
import { fileToUserAvatarDataUrl } from "@/lib/user-avatar-image";
import { loadVnScenes, loadVnSprites, type VnAssetLayout } from "@/lib/vn-asset-storage";
import { FacingMedia, FacingStage, useFacingMediaUrl } from "./facing-stage";

type View = "list" | "add" | "vn" | "dwelling" | "edit" | "generate";
type Candidate = { blob: Blob; url: string; mediaType: string };

function FacingDwellingScenes({ characterId, onSelect }: {
  characterId: string;
  onSelect: (blob: Blob, name: string) => void;
}) {
  const [rooms, setRooms] = useState<{ id: string; name: string; blob: Blob; url: string }[]>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const urls: string[] = [];
    void (async () => {
      const layout = await loadDwellingLayout(characterId);
      const sources = await Promise.all((layout?.layout.rooms ?? []).map(async room => {
        if (!room.imageAssetId) return null;
        const media = await loadMediaBlob(room.imageAssetId).catch(() => null);
        if (!media?.mimeType.startsWith("image/") || !media.blob.size || !active) return null;
        const blob = media.blob.slice(0, media.blob.size, media.mimeType);
        const url = URL.createObjectURL(blob);
        urls.push(url);
        return { id: room.id, name: room.name, blob, url };
      }));
      if (active) setRooms(sources.filter((room): room is NonNullable<typeof room> => !!room));
    })().catch(() => { if (active) setError("栖所图片读取失败，请返回后重试。"); });
    return () => { active = false; urls.forEach(url => URL.revokeObjectURL(url)); };
  }, [characterId]);

  if (error) return <p className="facing-error" role="alert">{error}</p>;
  if (!rooms) return <p className="facing-empty" role="status">正在读取栖所图片…</p>;
  if (!rooms.length) return <p className="facing-empty">这个角色的栖所还没有可导入的房间图。</p>;
  return <div className="facing-grid">{rooms.map(room => <button type="button" key={room.id} className="facing-asset-tile"
    onClick={() => onSelect(room.blob, room.name)}>
    <span className="facing-thumb"><img src={room.url} alt="" loading="lazy" /></span><span>{room.name}</span>
  </button>)}</div>;
}

function FacingAssetTile({ asset, onClick, selected, disabled }: {
  asset: FacingAsset; onClick: () => void; selected?: boolean; disabled?: boolean;
}) {
  const url = useFacingMediaUrl(asset);
  return <button type="button" className="facing-asset-tile" onClick={onClick} aria-pressed={selected} disabled={disabled}>
    <span className="facing-thumb">
      {url ? <FacingMedia url={url} mediaType={asset.mediaType} name="" /> : <ImagePlus size={23} aria-hidden />}
      {selected !== undefined && <span className="facing-asset-check" aria-hidden="true">{selected && <Check size={14} />}</span>}
    </span>
    <span>{facingAssetLocation(asset)} · {facingAssetMood(asset)}</span>
  </button>;
}

function readFile(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("无法读取参考图。"));
    reader.readAsDataURL(file);
  });
}

export function FacingAssets({ character, assets, groups, onBack, onChange, onDelete }: {
  character: Character;
  assets: FacingAsset[];
  groups: FacingSceneGroup[];
  onBack: () => void;
  onChange: () => void;
  onDelete: (assetIds: readonly string[]) => Promise<void>;
}) {
  const [view, setView] = useState<View>("list");
  const [edited, setEdited] = useState<FacingAsset>();
  const [selection, setSelection] = useState<Set<string> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null);
  const [candidate, setCandidate] = useState<Candidate>();
  const [mood, setMood] = useState("默认");
  const [customMood, setCustomMood] = useState("");
  const [duration, setDuration] = useState(3);
  const [layout, setLayout] = useState<VnAssetLayout>({});
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState<string>(FACING_IMAGE_LOCATIONS[0]);
  const [customLocation, setCustomLocation] = useState("");
  const [originalDescription, setOriginalDescription] = useState<string>();
  const [polishGuidance, setPolishGuidance] = useState("");
  const [polishNotice, setPolishNotice] = useState("");
  const [polishing, setPolishing] = useState(false);
  const [reference, setReference] = useState("text");
  const [referenceFile, setReferenceFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const control = useRef<AbortController | null>(null);
  const upload = useRef<HTMLInputElement>(null);
  const editedUrl = useFacingMediaUrl(edited);
  const locations = Array.from(new Set([...FACING_IMAGE_LOCATIONS, ...groups.map(group => group.name)]));
  const targetLocation = location === "custom" ? customLocation.trim() : location;
  const emotion = mood === "custom" ? customMood.trim() : mood;
  const targetGroup = groups.find(group => group.name === targetLocation);
  const currentPortrait = targetGroup?.portrait;
  const category = edited?.category ?? "portrait";
  const fullAsset = !edited || edited.composition === "full";
  const layoutDefaults = { x: 50, y: category === "portrait" && !fullAsset ? 100 : 50, scale: 100 };
  const allSelected = !!selection && assets.length > 0 && assets.every(asset => selection.has(asset.id));

  useEffect(() => () => control.current?.abort(), []);
  useEffect(() => () => {
    if (candidate?.url.startsWith("blob:")) URL.revokeObjectURL(candidate.url);
  }, [candidate]);

  function reset() {
    control.current?.abort();
    control.current = null;
    setBusy(false);
    setPolishing(false);
    setError("");
    setConfirmDelete(null);
    setSelection(null);
    setEdited(undefined);
    setCandidate(undefined);
    setMood("默认");
    setCustomMood("");
    setLayout({});
    setDuration(3);
    setView("list");
  }

  function chooseLocation(place: string) {
    const preset = locations.includes(place);
    setLocation(preset ? place : "custom");
    setCustomLocation(preset ? "" : place);
  }

  function openAdd(place?: string) {
    chooseLocation(place ?? FACING_IMAGE_LOCATIONS[0]);
    const existing = groups.find(group => group.name === place)?.assets.filter(asset => asset.composition === "full") ?? [];
    const usedMoods = new Set(existing.map(facingAssetMood));
    setMood(usedMoods.has("默认") ? FACING_REACTIONS.find(item => !usedMoods.has(item)) ?? "custom" : "默认");
    setCustomMood("");
    setView("add");
  }

  function newAsset(file: Blob, filename: string, place?: string) {
    const mediaType = facingMediaType(file, filename);
    if (!mediaType) {
      setError("请选择支持的图片、动图或视频。");
      return;
    }
    if (place) {
      chooseLocation(place);
      setMood("默认");
      setCustomMood("");
    }
    setEdited(undefined);
    setCandidate({ blob: file, url: URL.createObjectURL(file), mediaType });
    setDuration(3);
    setLayout({});
    setError("");
    setView("edit");
  }

  async function chooseVn(item: { name: string; id: string; place?: string }) {
    setBusy(true);
    setError("");
    try {
      const url = await getThemeAssetDataUrl(item.id);
      if (!url?.startsWith("data:")) throw new Error("找不到此漫卷素材。");
      newAsset(await (await fetch(url)).blob(), item.name, item.place);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取漫卷素材失败。");
    } finally { setBusy(false); }
  }

  function edit(asset: FacingAsset) {
    const label = facingAssetMood(asset);
    const preset = ["默认", ...FACING_REACTIONS].includes(label);
    chooseLocation(facingAssetLocation(asset));
    setMood(preset ? label : "custom");
    setCustomMood(preset ? "" : label);
    setEdited(asset);
    setCandidate(undefined);
    setDuration(asset.durationMs / 1000);
    setLayout(asset.layout ?? {});
    setError("");
    setView("edit");
  }

  function openGeneration() {
    setEdited(undefined);
    setCandidate(undefined);
    const canGenerateFromReference = resolveConfiguredImageGenerationSettings(character.id, "facing").provider !== "novelai";
    setReference(canGenerateFromReference && currentPortrait && !currentPortrait.mediaType.startsWith("video/") ? "portrait"
      : canGenerateFromReference && character.avatar ? "avatar" : "text");
    setReferenceFile(undefined);
    setDescription("");
    setOriginalDescription(undefined);
    setPolishNotice("");
    setDuration(3);
    setLayout(currentPortrait?.composition === "full" ? currentPortrait.layout ?? {} : {});
    setError("");
    setView("generate");
  }

  async function loadReference(forPolish: boolean, signal: AbortSignal): Promise<string | undefined> {
    let source: string | null | undefined;
    if (reference === "portrait" && currentPortrait) source = await getThemeAssetDataUrl(currentPortrait.mediaId);
    if (reference === "avatar" || (forPolish && reference === "text")) source = character.avatar;
    if (reference === "file" && referenceFile) source = await readFile(referenceFile);
    if (reference !== "text" && !source) throw new Error("先选一张可读的参考图。");
    if (!source) return undefined;
    if (!forPolish && source.startsWith("data:image/")) return source;
    const response = await fetch(source, { signal });
    if (!response.ok) throw new Error("暂时无法读取这张参考图，请重新选择。");
    const blob = await response.blob();
    if (!blob.type.startsWith("image/")) throw new Error("请选择图片作为参考图。");
    // A still frame keeps animated portrait references readable by vision models.
    return forPolish ? fileToUserAvatarDataUrl(new File([blob], "reference", { type: blob.type }), 1024) : readFile(blob);
  }

  async function polish() {
    if (busy || control.current) return;
    if (!targetLocation || !emotion) { setError("请设置场景和情绪。"); return; }
    if (reference === "file" && !referenceFile) { setError("请先上传参考图。"); return; }
    const run = new AbortController();
    control.current = run;
    const hasReference = reference !== "text" || !!character.avatar;
    setBusy(true);
    setPolishing(true);
    setError("");
    setPolishNotice("");
    try {
      const result = await polishFacingImageDescription({
        character, purpose: emotion === "默认" ? "平时的自然神情" : emotion,
        description, guidance: polishGuidance, location: targetLocation, hasReference, loadReference: () => loadReference(true, run.signal), signal: run.signal,
      });
      if (run.signal.aborted) return;
      setOriginalDescription(description);
      setDescription(result.description);
      setPolishNotice(hasReference && !result.usedReference
        ? "当前文字配置未开启识图，本次按角色设定和描述润色。"
        : result.usedReference ? "已结合角色设定和参考图润色。" : "已结合角色设定润色。");
    } catch (cause) {
      if (!run.signal.aborted) setError(cause instanceof Error ? cause.message : "润色失败，请重试。");
    } finally {
      if (control.current === run) {
        control.current = null;
        setBusy(false);
        setPolishing(false);
      }
    }
  }

  async function generate(event: FormEvent) {
    event.preventDefault();
    if (control.current || !targetLocation || !emotion) return;
    setBusy(true);
    setError("");
    const run = new AbortController();
    control.current = run;
    try {
      const ref = await loadReference(false, run.signal);
      const moodInstruction = emotion === "默认" ? "角色保持平时自然的神情。" : `角色表现「${emotion}」，保持该场景的构图与环境。`;
      const result = await generateImageFromConfiguredApi({
        characterId: character.id, appId: "facing",
        description: [facingFullImageInstruction(targetLocation), moodInstruction, description.trim()].filter(Boolean).join("\n"),
        referenceSelection: { character: false, user: false }, explicitReferenceImage: ref ?? undefined,
        portraitOutput: true,
        signal: run.signal,
      });
      if (run.signal.aborted) return;
      if (!result) throw new Error("先在设置里启用生图并为「面对面」绑定配置。");
      setCandidate({ blob: result.blob, url: result.dataUrl, mediaType: facingMediaType(result.blob) || "image/png" });
    } catch (cause) {
      if (!run.signal.aborted) setError(cause instanceof Error ? cause.message : "生图失败，请重试。");
    } finally {
      if (control.current === run) { control.current = null; setBusy(false); }
    }
  }

  async function save() {
    if (busy || !emotion || !targetLocation || (!candidate && !edited)) return;
    if (!edited && emotion !== "默认" && !(targetGroup?.portrait?.composition === "full")) {
      setError("请先为这个场景保存一张默认画面，再添加情绪素材。");
      return;
    }
    if (category === "portrait" && fullAsset && targetGroup?.assets.some(asset => asset.id !== edited?.id
      && asset.composition === "full" && facingAssetMood(asset) === emotion)) {
      setError(`「${targetLocation}」已有「${emotion}」画面，请选择其他情绪或删除原素材后再保存。`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const use = category === "scene" ? "scene" : emotion === "默认" ? "idle" : "reaction";
      const changes = { category, characterId: character.id, name: category === "scene" ? targetLocation : emotion, use, layout,
        durationMs: duration * 1000, composition: fullAsset ? "full" as const : undefined, location: targetLocation } as const;
      if (edited) await updateFacingAsset({ ...edited, ...changes });
      else await saveFacingAsset({ ...changes, id: facingId() }, candidate!.blob, candidate!.mediaType);
      onChange();
      reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败。");
    } finally { setBusy(false); }
  }

  function endSelection() {
    setSelection(null);
    setError("");
  }

  function toggleAsset(id: string) {
    setSelection(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelection(current => {
      const next = new Set(current);
      for (const asset of assets) {
        if (allSelected) next.delete(asset.id);
        else next.add(asset.id);
      }
      return next;
    });
  }

  async function removeAssets() {
    if (!confirmDelete?.length || busy) return;
    setConfirmDelete(null);
    setBusy(true);
    setError("");
    try {
      await onDelete(confirmDelete);
      reset();
    } catch {
      setError("素材删除失败，请重试。");
    } finally { setBusy(false); }
  }

  const currentUrl = candidate?.url ?? editedUrl;
  const currentType = candidate?.mediaType ?? edited?.mediaType ?? "";
  function clearGeneratedPreview() {
    if (view === "generate") setCandidate(undefined);
  }
  const sceneFields = <>
    <label>场景<select value={location} disabled={busy} onChange={event => {
      setLocation(event.target.value);
      clearGeneratedPreview();
      if (reference === "portrait") setReference(character.avatar ? "avatar" : "text");
    }}>
      {locations.map(place => <option key={place}>{place}</option>)}
      <option value="custom">自定义场景</option>
    </select></label>
    {location === "custom" && <label>场景名称<input value={customLocation} disabled={busy} maxLength={60}
      placeholder="例如雨夜酒店" onChange={event => { setCustomLocation(event.target.value); clearGeneratedPreview(); }} /></label>}
    {category === "portrait" && <label>画面情绪<select value={mood} disabled={busy} onChange={event => { setMood(event.target.value); clearGeneratedPreview(); }}>
      {["默认", ...FACING_REACTIONS].map(item => <option key={item}>{item}</option>)}
      <option value="custom">自定义情绪</option>
    </select></label>}
    {mood === "custom" && category === "portrait" && <label>情绪名称<input value={customMood} disabled={busy} maxLength={24}
      placeholder="例如害羞" onChange={event => { setCustomMood(event.target.value); clearGeneratedPreview(); }} /></label>}
  </>;
  return <>
    <header className="facing-header"><button type="button" className="facing-back" onClick={view === "list" ? selection ? endSelection : onBack : reset}
      aria-label="返回" disabled={(view === "edit" || view === "list") && busy}>‹</button><h1>{view === "generate" ? "AI 生图" : view === "edit" ? "素材详情"
        : view === "dwelling" ? "栖所场景" : "场景素材"}</h1>
      {view === "edit" && edited && <button type="button" className="facing-icon facing-delete" aria-label="删除素材" title="删除素材"
        disabled={busy} onClick={() => setConfirmDelete([edited.id])}><Trash2 size={18} /></button>}
    </header>
    <main className="facing-scroll">
      {view === "list" && <>
        <div className="facing-row"><span>{character.name}</span><div className="facing-choices">
          {selection ? <>
            <button type="button" className="facing-small" disabled={busy || !assets.length} onClick={toggleAll}>
              {allSelected ? "取消全选" : "全选"}
            </button>
            <button type="button" className="facing-small" disabled={busy} onClick={endSelection}>取消选择</button>
          </> : <>
            {!!assets.length && <button type="button" className="facing-small" onClick={() => setSelection(new Set())}>选择</button>}
            <button type="button" className="facing-small" onClick={() => openAdd()}><Plus size={16} />添加场景素材</button>
          </>}
        </div></div>
        {groups.map(group => <section className="facing-material-group" key={group.name} aria-label={group.name}>
          <div className="facing-row"><h2>{group.name}</h2>
            {!selection && <button type="button" className="facing-small" aria-label={`添加${group.name}素材`} onClick={() => openAdd(group.name)}><Plus size={15} />添加</button>}
          </div>
          <div className="facing-grid">{group.assets.map(asset => <FacingAssetTile key={asset.id} asset={asset}
            selected={selection?.has(asset.id)} disabled={busy} onClick={() => selection ? toggleAsset(asset.id) : edit(asset)} />)}</div>
        </section>)}
        {!groups.length && <p className="facing-empty">还没有场景素材</p>}
      </>}
      {view === "vn" && <div className="facing-list">
        {loadVnScenes(character.id).map(item => <button type="button" key={item.id} disabled={busy} onClick={() =>
          void chooseVn({ name: item.name, id: item.assetId, place: item.name })}>{item.name}<ChevronRight size={16} /></button>)}
        {loadVnSprites(character.id).map(item => <button type="button" key={item.id} disabled={busy} onClick={() =>
          void chooseVn({ name: item.key, id: item.assetId })}>{item.key}<ChevronRight size={16} /></button>)}
        {!loadVnScenes(character.id).length && !loadVnSprites(character.id).length && <p className="facing-empty">漫卷里暂无可导入的素材</p>}
      </div>}
      {view === "dwelling" && <FacingDwellingScenes characterId={character.id} onSelect={(blob, place) => newAsset(blob, place, place)} />}
      {view === "edit" && <div className="facing-form">
        {currentUrl && <div className="facing-layout-preview" role="group" aria-label="画面实时预览">
          <FacingStage draft={{ category, name: `${targetLocation} · ${emotion}`, url: currentUrl, mediaType: currentType, layout, composition: fullAsset ? "full" : undefined }}
            scene={category === "portrait" && !fullAsset ? targetGroup?.backdrop : undefined}
            portrait={category === "scene" ? targetGroup?.portrait : undefined}
            fallback={category === "scene" ? character.avatar : undefined} name={character.name} />
        </div>}
        <div className="facing-form-layout">
          <label>横向位置<input type="range" min={0} max={100} value={layout.x ?? layoutDefaults.x} onChange={event => setLayout({ ...layout, x: +event.target.value })} /></label>
          <label>纵向位置<input type="range" min={0} max={100} value={layout.y ?? layoutDefaults.y} onChange={event => setLayout({ ...layout, y: +event.target.value })} /></label>
          <label>缩放<input type="range" min={category === "scene" || fullAsset ? 100 : 40} max={180} value={layout.scale ?? layoutDefaults.scale} onChange={event => setLayout({ ...layout, scale: +event.target.value })} /></label>
        </div>
        {(category === "scene" || fullAsset) && <p className="facing-layout-help">放大后可上下左右调整裁切位置。</p>}
        {sceneFields}
        {category === "portrait" && emotion && emotion !== "默认" &&
          <label>播放时长（秒）<input type="number" min={1} max={30} value={duration} onChange={event => setDuration(Math.max(1, Math.min(30, Number(event.target.value) || 1)))} /></label>}
        <button type="button" className="facing-primary" disabled={busy || !targetLocation || !emotion} onClick={() => void save()}>保存素材</button>
      </div>}
      {view === "generate" && <form className="facing-form" onSubmit={generate}>
        {sceneFields}
        <label>出图方式<select aria-label="出图方式" value={reference} onChange={event => setReference(event.target.value)}>
          <option value="text">文字生成</option>
          {currentPortrait && !currentPortrait.mediaType.startsWith("video/") && <option value="portrait">参考该场景的默认画面</option>}
          {character.avatar && <option value="avatar">参考角色头像</option>}
          <option value="file">上传参考图</option>
        </select></label>
        {reference === "file" && <label>参考图<input type="file" accept="image/*" onChange={event => setReferenceFile(event.target.files?.[0])} /></label>}
        <div className="facing-description">
          <div className="facing-row">
            <label htmlFor="facing-image-description">画面描述</label>
            <button type="button" className="facing-small" disabled={busy} onClick={() => void polish()}>
              <Sparkles size={15} aria-hidden />{polishing ? "正在润色…" : "AI 润色"}
            </button>
          </div>
          <textarea id="facing-image-description" value={description} onChange={event => setDescription(event.target.value)}
            rows={4} disabled={polishing} placeholder="可补充光线、衣着或动作" />
          {polishNotice && <div className="facing-polish-result">
            <span role="status">{polishNotice}</span>
            {originalDescription !== undefined && <button type="button" className="facing-link" disabled={busy} onClick={() => {
              setDescription(originalDescription);
              setOriginalDescription(undefined);
              setPolishNotice("");
            }}>恢复原描述</button>}
          </div>}
          <details className="facing-polish-options">
            <summary>润色要求</summary>
            <label>补充提示词<textarea value={polishGuidance} onChange={event => setPolishGuidance(event.target.value)}
              rows={2} disabled={busy} placeholder="例如保留现有构图，突出冷蓝光" /></label>
          </details>
        </div>
        <button className="facing-primary" disabled={busy || !targetLocation || !emotion}>{busy && !polishing ? "正在生成…" : candidate ? "再生成一张" : "生成预览"}</button>
        {candidate && <>
          <div className="facing-material-preview"><FacingMedia url={candidate.url} mediaType={candidate.mediaType} name="候选素材" /></div>
          <button type="button" className="facing-primary" disabled={busy} onClick={() => setView("edit")}>使用这张</button>
        </>}
      </form>}
      {error && <p className="facing-error" role="alert">{error}</p>}
    </main>
    {view === "list" && selection && <footer className="facing-selection-bar">
      <span role="status">已选 {selection.size} 项</span>
      <button type="button" className="facing-soft facing-delete" disabled={busy || !selection.size}
        onClick={() => setConfirmDelete(Array.from(selection))}><Trash2 size={16} />{busy ? "正在删除…" : "删除所选"}</button>
    </footer>}
    {confirmDelete && <ConfirmDialog title="删除素材？" message={edited ? `要从面对面移除「${facingAssetLocation(edited)} · ${facingAssetMood(edited)}」吗？` : `要从面对面移除选中的 ${confirmDelete.length} 项素材吗？`}
      icon={Trash2} variant="danger" overlayClassName="facing-delete-overlay" confirmLabel="确认删除"
      onConfirm={() => void removeAssets()} onCancel={() => setConfirmDelete(null)} />}
    {view === "add" && <div className="facing-overlay" onClick={reset}>
      <section className="facing-sheet" role="dialog" aria-modal="true" aria-label="添加素材" onClick={event => event.stopPropagation()}>
        <header><h2>添加场景素材</h2><button type="button" onClick={reset}>完成</button></header>
        <div className="facing-list">
          <button type="button" onClick={() => upload.current?.click()}>从手机导入<ChevronRight size={16} /></button>
          <button type="button" onClick={() => setView("vn")}>从漫卷资源选<ChevronRight size={16} /></button>
          <button type="button" onClick={() => setView("dwelling")}>从角色栖所选<ChevronRight size={16} /></button>
          <button type="button" onClick={openGeneration}>AI 生图<ChevronRight size={16} /></button>
        </div>
      </section>
    </div>}
    <input ref={upload} type="file" accept={FACING_MEDIA_ACCEPT} hidden onChange={event => {
      const file = event.target.files?.[0];
      if (file) newAsset(file, file.name);
      event.target.value = "";
    }} />
  </>;
}
