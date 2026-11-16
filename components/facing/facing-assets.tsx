"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ChevronRight, ImagePlus, Plus, Sparkles, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/modal";
import type { Character } from "@/lib/character-types";
import { loadDwellingLayout } from "@/lib/dwelling-storage";
import { facingFullImageInstruction, polishFacingImageDescription } from "@/lib/facing-engine";
import { FACING_IMAGE_LOCATIONS, FACING_MEDIA_ACCEPT, FACING_REACTIONS, facingId, facingMediaType, saveFacingAsset, updateFacingAsset,
  type FacingAsset, type FacingCharacterSettings } from "@/lib/facing-storage";
import { generateImageFromConfiguredApi, resolveConfiguredImageGenerationSettings } from "@/lib/image-generation-service";
import { removeConnectedEdgeBackgroundFromDataUrl } from "@/lib/image-background-removal";
import { loadMediaBlob } from "@/lib/media-cache-storage";
import { getThemeAssetDataUrl } from "@/lib/theme-storage";
import { fileToUserAvatarDataUrl } from "@/lib/user-avatar-image";
import { loadVnScenes, loadVnSprites, type VnAssetLayout } from "@/lib/vn-asset-storage";
import { FacingMedia, FacingStage, useFacingMediaUrl } from "./facing-stage";

type Category = FacingAsset["category"];
type View = "list" | "add" | "vn" | "dwelling" | "edit" | "generate";
type Candidate = { blob: Blob; url: string; mediaType: string } & Pick<FacingAsset, "composition" | "location">;

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

export function FacingAssetTile({ asset, onClick }: { asset: FacingAsset; onClick: () => void }) {
  const url = useFacingMediaUrl(asset);
  return <button type="button" className="facing-asset-tile" onClick={onClick}>
    <span className="facing-thumb">{url ? <FacingMedia url={url} mediaType={asset.mediaType} name="" /> : <ImagePlus size={23} aria-hidden />}</span>
    <span>{asset.name}</span>
    <small>{asset.use === "idle" ? "待机" : asset.use === "reaction" ? "反应" : "场景"}{asset.composition === "full" && ` · ${asset.location || "完整画面"}`}</small>
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

export function FacingAssets({ character, assets, settings, previewPortrait, previewScene, initialCategory, onBack, onChange, onSelect, onDelete }: {
  character: Character;
  assets: FacingAsset[];
  settings: FacingCharacterSettings;
  previewPortrait?: FacingAsset;
  previewScene?: FacingAsset;
  initialCategory: Category;
  onBack: () => void;
  onChange: () => void;
  onSelect: (asset: FacingAsset) => Promise<void>;
  onDelete: (asset: FacingAsset) => Promise<void>;
}) {
  const [category, setCategory] = useState<Category>(initialCategory);
  const [view, setView] = useState<View>("list");
  const [edited, setEdited] = useState<FacingAsset>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [candidate, setCandidate] = useState<Candidate>();
  const [name, setName] = useState("");
  const [use, setUse] = useState<FacingAsset["use"]>("idle");
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
  const fullGeneration = category === "portrait" && settings.useScene === false;
  const layeredPortrait = assets.find(item => item.id === settings.portraitId && item.use === "idle");
  const fullPortrait = assets.find(item => item.id === settings.fullPortraitId && item.use === "idle");
  const currentPortrait = settings.useScene === false ? fullPortrait ?? layeredPortrait : layeredPortrait;
  const targetLocation = fullGeneration ? (location === "custom" ? customLocation.trim() : location) : undefined;
  const fullAsset = (candidate ?? edited)?.composition === "full";
  const visible = assets.filter(item => item.category === category);
  const layoutDefaults = { x: 50, y: category === "portrait" && !fullAsset ? 100 : 50, scale: 100 };

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
    setConfirmDelete(false);
    setEdited(undefined);
    setCandidate(undefined);
    setName("");
    setUse(category === "scene" ? "scene" : "idle");
    setLayout({});
    setDuration(3);
    setView("list");
  }

  function newAsset(file: Blob, filename: string, sourceLayout?: VnAssetLayout) {
    const mediaType = facingMediaType(file, filename);
    if (!mediaType) {
      setError("请选择支持的图片、动图或视频。");
      return;
    }
    setEdited(undefined);
    setCandidate({ blob: file, url: URL.createObjectURL(file), mediaType, composition: fullGeneration ? "full" : undefined });
    setName(filename.replace(/\.[^./]+$/, "").slice(0, 50));
    setUse(category === "scene" ? "scene" : visible.some(item => item.use === "idle" && (item.composition === "full") === fullGeneration) ? "reaction" : "idle");
    setDuration(3);
    setLayout(fullGeneration ? {} : sourceLayout ?? {});
    setError("");
    setView("edit");
  }

  async function chooseVn(item: { name: string; id: string; layout?: VnAssetLayout }) {
    setBusy(true);
    setError("");
    try {
      const url = await getThemeAssetDataUrl(item.id);
      if (!url?.startsWith("data:")) throw new Error("找不到此漫卷素材。");
      newAsset(await (await fetch(url)).blob(), item.name, item.layout);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取漫卷素材失败。");
    } finally { setBusy(false); }
  }

  function edit(asset: FacingAsset) {
    setEdited(asset);
    setCandidate(undefined);
    setName(asset.name);
    setUse(asset.use);
    setDuration(asset.durationMs / 1000);
    setLayout(asset.layout ?? {});
    setError("");
    setView("edit");
  }

  function openGeneration() {
    setEdited(undefined);
    setCandidate(undefined);
    const canGenerateFromReference = resolveConfiguredImageGenerationSettings(character.id, "facing").provider !== "novelai";
    setReference(category === "portrait" && canGenerateFromReference && currentPortrait && !currentPortrait.mediaType.startsWith("video/") ? "portrait"
      : category === "portrait" && canGenerateFromReference && character.avatar ? "avatar" : "text");
    setReferenceFile(undefined);
    setDescription("");
    const previousLocation = fullPortrait?.location;
    const presetLocation = FACING_IMAGE_LOCATIONS.find(item => item === previousLocation);
    setLocation(presetLocation ?? (previousLocation ? "custom" : FACING_IMAGE_LOCATIONS[0]));
    setCustomLocation(previousLocation && !presetLocation ? previousLocation : "");
    setOriginalDescription(undefined);
    setPolishNotice("");
    setName(category === "portrait" ? "待机" : "");
    setUse(category === "portrait" ? "idle" : "scene");
    setDuration(3);
    setLayout(category === "portrait" ? (fullGeneration ? fullPortrait : layeredPortrait)?.layout ?? {} : {});
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
    if (fullGeneration && !targetLocation) { setError("请填写画面地点。"); return; }
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
        character, category, purpose: name.trim() || (use === "reaction" ? "表情或动作" : use === "idle" ? "待机" : "场景"),
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
    if (control.current || (fullGeneration ? !targetLocation : !description.trim())) return;
    setBusy(true);
    setError("");
    const run = new AbortController();
    control.current = run;
    try {
      const ref = await loadReference(false, run.signal);
      const instruction = targetLocation ? facingFullImageInstruction(targetLocation) : category === "scene"
        ? "生成竖屏场景背景，镜头平视，预留人物站位，画面中没有人物。"
        : "生成竖屏角色前景立绘，人物边缘完整。沿用参考图的脸部特征、发型、服装、镜头高度和站位。输出透明底。若只能生成实底，请使用单一纯色底。";
      const result = await generateImageFromConfiguredApi({
        characterId: character.id, appId: "facing", description: [instruction, `用途：${name.trim() || (category === "portrait" ? "人物待机" : "场景")}`, description.trim()].filter(Boolean).join("\n"),
        referenceSelection: { character: false, user: false }, explicitReferenceImage: ref ?? undefined,
        portraitOutput: Boolean(targetLocation),
        signal: run.signal,
      });
      if (run.signal.aborted) return;
      if (!result) throw new Error("先在设置里启用生图并为「面对面」绑定配置。");
      setCandidate({ blob: result.blob, url: result.dataUrl, mediaType: facingMediaType(result.blob) || "image/png",
        composition: targetLocation ? "full" : undefined, location: targetLocation });
    } catch (cause) {
      if (!run.signal.aborted) setError(cause instanceof Error ? cause.message : "生图失败，请重试。");
    } finally {
      if (control.current === run) { control.current = null; setBusy(false); }
    }
  }

  async function removeBackground() {
    if (!candidate) return;
    setBusy(true);
    setError("");
    try {
      const result = await removeConnectedEdgeBackgroundFromDataUrl(candidate.url, { tolerance: 42, feather: 2 });
      if (!result.removedPixels) throw new Error("没有找到可去除的边缘底色。");
      setCandidate({ ...candidate, blob: result.blob, url: URL.createObjectURL(result.blob), mediaType: "image/png" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "去底失败。");
    } finally { setBusy(false); }
  }

  async function save(activate: boolean) {
    if (busy || !name.trim() || (!candidate && !edited)) return;
    setBusy(true);
    setError("");
    try {
      const changes = { category, characterId: character.id, name: name.trim(), use, layout, durationMs: duration * 1000 };
      const asset = edited ? { ...edited, ...changes } : await saveFacingAsset({ ...changes, id: facingId(),
        composition: candidate!.composition, location: candidate!.location }, candidate!.blob, candidate!.mediaType);
      if (edited) await updateFacingAsset(asset);
      // Keep the saved asset available even if setting it active needs a retry.
      setEdited(asset);
      setCandidate(undefined);
      setView("edit");
      onChange();
      if (activate && use !== "reaction") await onSelect(asset);
      reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败。");
    } finally { setBusy(false); }
  }

  async function removeAsset() {
    if (!edited || busy) return;
    setConfirmDelete(false);
    setBusy(true);
    setError("");
    try {
      await onDelete(edited);
      reset();
    } catch {
      setError("素材删除失败，请重试。");
    } finally { setBusy(false); }
  }

  const currentUrl = candidate?.url ?? editedUrl;
  const currentType = candidate?.mediaType ?? edited?.mediaType ?? "";
  return <>
    <header className="facing-header"><button type="button" className="facing-back" onClick={view === "list" ? onBack : reset}
      aria-label="返回" disabled={view === "edit" && busy}>‹</button><h1>{view === "generate" ? "AI 生图" : view === "edit" ? "素材详情"
        : view === "dwelling" ? "栖所场景" : "立绘与场景"}</h1>
      {view === "edit" && edited && <button type="button" className="facing-icon facing-delete" aria-label="删除素材" title="删除素材"
        disabled={busy} onClick={() => setConfirmDelete(true)}><Trash2 size={18} /></button>}
    </header>
    <main className="facing-scroll">
      {view === "list" && <>
        <div className="facing-segments" role="group" aria-label="素材分类">
          <button type="button" aria-pressed={category === "portrait"} onClick={() => setCategory("portrait")}>立绘</button>
          <button type="button" aria-pressed={category === "scene"} onClick={() => setCategory("scene")}>场景</button>
        </div>
        <div className="facing-row"><span>{character.name}</span><button type="button" className="facing-small" onClick={() => setView("add")}><Plus size={16} />添加</button></div>
        {visible.length ? <div className="facing-grid">{visible.map(asset => <FacingAssetTile key={asset.id} asset={asset} onClick={() => edit(asset)} />)}</div>
          : <p className="facing-empty">还没有{category === "portrait" ? "立绘" : "场景"}素材</p>}
      </>}
      {view === "vn" && <div className="facing-list">
        {category === "portrait"
          ? loadVnSprites(character.id).map(item => <button type="button" key={item.id} disabled={busy} onClick={() =>
            void chooseVn({ name: item.key, id: item.assetId, layout: item.layout })}>{item.key}<ChevronRight size={16} /></button>)
          : loadVnScenes(character.id).map(item => <button type="button" key={item.id} disabled={busy} onClick={() =>
            void chooseVn({ name: item.name, id: item.assetId, layout: item.layout })}>{item.name}<ChevronRight size={16} /></button>)}
        {(category === "portrait" ? loadVnSprites(character.id) : loadVnScenes(character.id)).length === 0 && <p className="facing-empty">漫卷里暂无可导入的素材</p>}
      </div>}
      {view === "dwelling" && <FacingDwellingScenes characterId={character.id} onSelect={newAsset} />}
      {view === "edit" && <div className="facing-form">
        {currentUrl && <div className="facing-layout-preview" role="group" aria-label="画面实时预览">
          <FacingStage draft={{ category, name, url: currentUrl, mediaType: currentType, layout, composition: fullAsset ? "full" : undefined }}
            scene={category === "portrait" && !fullAsset ? previewScene : undefined}
            portrait={category === "scene" ? previewPortrait : undefined}
            fallback={category === "scene" ? character.avatar : undefined} name={character.name} />
        </div>}
        <div className="facing-form-layout">
          <label>横向位置<input type="range" min={0} max={100} value={layout.x ?? layoutDefaults.x} onChange={event => setLayout({ ...layout, x: +event.target.value })} /></label>
          <label>纵向位置<input type="range" min={0} max={100} value={layout.y ?? layoutDefaults.y} onChange={event => setLayout({ ...layout, y: +event.target.value })} /></label>
          <label>缩放<input type="range" min={category === "scene" || fullAsset ? 100 : 40} max={180} value={layout.scale ?? layoutDefaults.scale} onChange={event => setLayout({ ...layout, scale: +event.target.value })} /></label>
        </div>
        {(category === "scene" || fullAsset) && <p className="facing-layout-help">放大后可上下左右调整裁切位置。</p>}
        <label>名称<input value={name} onChange={event => setName(event.target.value)} maxLength={50} /></label>
        {category === "portrait" && <label>用途<select aria-label="用途" value={use} onChange={event => setUse(event.target.value as FacingAsset["use"])}>
          <option value="idle">待机立绘</option><option value="reaction">表情或动作</option>
        </select></label>}
        {use === "reaction" && <>
          <div className="facing-choices">{FACING_REACTIONS.map(item => <button type="button" key={item} className="facing-small" onClick={() => setName(item)}>{item}</button>)}</div>
          <label>播放时长（秒）<input type="number" min={1} max={30} value={duration} onChange={event => setDuration(Math.max(1, Math.min(30, Number(event.target.value) || 1)))} /></label>
        </>}
        <div className="facing-pair"><button type="button" className="facing-soft" disabled={busy || !name.trim()} onClick={() => void save(false)}>保存到资源</button>
          {use !== "reaction" && <button type="button" className="facing-primary" disabled={busy || !name.trim()} onClick={() => void save(true)}>
            {category === "scene" ? "设为当前场景" : "设为待机"}
          </button>}
        </div>
      </div>}
      {view === "generate" && <form className="facing-form" onSubmit={generate}>
        <label>素材名称<input value={name} placeholder={category === "scene" ? "例如雨夜窗边" : "例如微笑"} onChange={event => setName(event.target.value)} maxLength={50} /></label>
        {category === "portrait" && <label>用途<select aria-label="用途" value={use} onChange={event => setUse(event.target.value as FacingAsset["use"])}>
          <option value="idle">待机立绘</option><option value="reaction">表情或动作</option>
        </select></label>}
        {use === "reaction" && <div className="facing-choices">{FACING_REACTIONS.map(item => <button type="button" key={item} className="facing-small" onClick={() => setName(item)}>{item}</button>)}</div>}
        {fullGeneration && <>
          <label>画面地点<select value={location} disabled={busy} onChange={event => setLocation(event.target.value)}>
            {FACING_IMAGE_LOCATIONS.map(place => <option key={place}>{place}</option>)}
            <option value="custom">自定义</option>
          </select></label>
          {location === "custom" && <label>自定义地点<input value={customLocation} disabled={busy} required maxLength={100}
            placeholder="例如深夜的酒店落地窗边" onChange={event => setCustomLocation(event.target.value)} /></label>}
        </>}
        <label>出图方式<select aria-label="出图方式" value={reference} onChange={event => setReference(event.target.value)}>
          <option value="text">文字生成</option>
          {currentPortrait && !currentPortrait.mediaType.startsWith("video/") && <option value="portrait">{currentPortrait.composition === "full" ? "参考当前完整画面" : "参考当前待机立绘"}</option>}
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
            rows={4} disabled={polishing} required={!fullGeneration} placeholder={fullGeneration ? "可补充光线、衣着或动作" : undefined} />
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
        <button className="facing-primary" disabled={busy || (fullGeneration ? !targetLocation : !description.trim())}>{busy && !polishing ? "正在生成…" : candidate ? "再生成一张" : "生成预览"}</button>
        {candidate && <>
          <div className="facing-material-preview"><FacingMedia url={candidate.url} mediaType={candidate.mediaType} name="候选素材" /></div>
          <div className={fullAsset ? "facing-form" : "facing-pair"}>
            {category === "portrait" && !fullAsset && <button type="button" className="facing-soft" disabled={busy} onClick={() => void removeBackground()}>去底</button>}
            <button type="button" className="facing-primary" disabled={busy} onClick={() => setView("edit")}>使用这张</button>
          </div>
        </>}
      </form>}
      {error && <p className="facing-error" role="alert">{error}</p>}
    </main>
    {confirmDelete && edited && <ConfirmDialog title="删除素材？" message={`要从面对面移除「${edited.name}」吗？`}
      icon={Trash2} variant="danger" overlayClassName="facing-delete-overlay" confirmLabel="确认删除"
      onConfirm={() => void removeAsset()} onCancel={() => setConfirmDelete(false)} />}
    {view === "add" && <div className="facing-overlay" onClick={reset}>
      <section className="facing-sheet" role="dialog" aria-modal="true" aria-label="添加素材" onClick={event => event.stopPropagation()}>
        <header><h2>添加{category === "portrait" ? "立绘" : "场景"}</h2><button type="button" onClick={reset}>完成</button></header>
        <div className="facing-list">
          <button type="button" onClick={() => upload.current?.click()}>从手机导入<ChevronRight size={16} /></button>
          <button type="button" onClick={() => setView("vn")}>从漫卷资源选<ChevronRight size={16} /></button>
          {category === "scene" && <button type="button" onClick={() => setView("dwelling")}>从角色栖所选<ChevronRight size={16} /></button>}
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
