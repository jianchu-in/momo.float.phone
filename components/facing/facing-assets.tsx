"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ChevronRight, ImagePlus, Plus } from "lucide-react";
import type { Character } from "@/lib/character-types";
import { FACING_MEDIA_ACCEPT, FACING_REACTIONS, facingId, facingMediaType, saveFacingAsset, updateFacingAsset,
  type FacingAsset, type FacingCharacterSettings } from "@/lib/facing-storage";
import { generateImageFromConfiguredApi } from "@/lib/image-generation-service";
import { removeConnectedEdgeBackgroundFromDataUrl } from "@/lib/image-background-removal";
import { getThemeAssetDataUrl } from "@/lib/theme-storage";
import { loadVnScenes, loadVnSprites, type VnAssetLayout } from "@/lib/vn-asset-storage";
import { FacingMedia, useFacingMediaUrl } from "./facing-stage";

type Category = FacingAsset["category"];
type View = "list" | "add" | "vn" | "edit" | "generate";

export function FacingAssetTile({ asset, onClick }: { asset: FacingAsset; onClick: () => void }) {
  const url = useFacingMediaUrl(asset);
  return <button type="button" className="facing-asset-tile" onClick={onClick}>
    <span className="facing-thumb">{url ? <FacingMedia url={url} mediaType={asset.mediaType} name="" /> : <ImagePlus size={23} aria-hidden />}</span>
    <span>{asset.name}</span>
    <small>{asset.use === "idle" ? "待机" : asset.use === "reaction" ? "反应" : "场景"}</small>
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

export function FacingAssets({ character, assets, settings, initialCategory, onBack, onChange, onSelect }: {
  character: Character;
  assets: FacingAsset[];
  settings: FacingCharacterSettings;
  initialCategory: Category;
  onBack: () => void;
  onChange: () => void;
  onSelect: (asset: FacingAsset) => Promise<void>;
}) {
  const [category, setCategory] = useState<Category>(initialCategory);
  const [view, setView] = useState<View>("list");
  const [edited, setEdited] = useState<FacingAsset>();
  const [candidate, setCandidate] = useState<{ blob: Blob; url: string; mediaType: string }>();
  const [name, setName] = useState("");
  const [use, setUse] = useState<FacingAsset["use"]>("idle");
  const [duration, setDuration] = useState(3);
  const [layout, setLayout] = useState<VnAssetLayout>({});
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("text");
  const [referenceFile, setReferenceFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const control = useRef<AbortController | null>(null);
  const upload = useRef<HTMLInputElement>(null);
  const editedUrl = useFacingMediaUrl(edited);
  const currentPortrait = assets.find(item => item.id === settings.portraitId && item.category === "portrait" && item.use === "idle");
  const visible = assets.filter(item => item.category === category);
  const layoutDefaults = { x: 50, y: category === "portrait" ? 100 : 50, scale: 100 };

  useEffect(() => () => control.current?.abort(), []);
  useEffect(() => () => {
    if (candidate?.url.startsWith("blob:")) URL.revokeObjectURL(candidate.url);
  }, [candidate]);

  function reset() {
    control.current?.abort();
    control.current = null;
    setBusy(false);
    setError("");
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
    setCandidate({ blob: file, url: URL.createObjectURL(file), mediaType });
    setName(filename.replace(/\.[^./]+$/, "").slice(0, 50));
    setUse(category === "scene" ? "scene" : visible.some(item => item.use === "idle") ? "reaction" : "idle");
    setDuration(3);
    setLayout(sourceLayout ?? {});
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
    setReference(category === "portrait" && currentPortrait && !currentPortrait.mediaType.startsWith("video/") ? "portrait"
      : category === "portrait" && character.avatar ? "avatar" : "text");
    setReferenceFile(undefined);
    setDescription("");
    setName(category === "portrait" ? "待机" : "");
    setUse(category === "portrait" ? "idle" : "scene");
    setDuration(3);
    setLayout(category === "portrait" ? currentPortrait?.layout ?? {} : {});
    setError("");
    setView("generate");
  }

  async function generate(event: FormEvent) {
    event.preventDefault();
    if (control.current || !description.trim()) return;
    setBusy(true);
    setError("");
    const run = new AbortController();
    control.current = run;
    try {
      let ref: string | null | undefined;
      if (reference === "portrait" && currentPortrait) ref = await getThemeAssetDataUrl(currentPortrait.mediaId);
      if (reference === "avatar") ref = character.avatar;
      if (reference === "file" && referenceFile) ref = await readFile(referenceFile);
      if (reference !== "text" && !ref) throw new Error("先选一张可读的参考图。");
      const instruction = category === "scene"
        ? "生成竖屏场景背景，镜头平视，预留人物站位，画面中没有人物。"
        : "生成竖屏角色前景立绘，人物边缘完整。沿用参考图的脸部特征、发型、服装、镜头高度和站位。输出透明底。若只能生成实底，请使用单一纯色底。";
      const result = await generateImageFromConfiguredApi({
        characterId: character.id, appId: "facing", description: `${instruction}\n用途：${name || "场景"}\n${description.trim()}`,
        referenceSelection: { character: false, user: false }, explicitReferenceImage: ref ?? undefined,
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
      const asset = edited ? { ...edited, ...changes } : await saveFacingAsset({ ...changes, id: facingId() }, candidate!.blob, candidate!.mediaType);
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

  const currentUrl = candidate?.url ?? editedUrl;
  const currentType = candidate?.mediaType ?? edited?.mediaType ?? "";
  return <>
    <header className="facing-header"><button type="button" className="facing-back" onClick={view === "list" ? onBack : reset}
      aria-label="返回">‹</button><h1>{view === "generate" ? "AI 生图" : view === "edit" ? "素材详情" : "立绘与场景"}</h1></header>
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
      {view === "edit" && <div className="facing-form">
        {currentUrl && <div className="facing-material-preview"><FacingMedia url={currentUrl} mediaType={currentType} name={name} /></div>}
        <label>名称<input value={name} onChange={event => setName(event.target.value)} maxLength={50} /></label>
        {category === "portrait" && <label>用途<select aria-label="用途" value={use} onChange={event => setUse(event.target.value as FacingAsset["use"])}>
          <option value="idle">待机立绘</option><option value="reaction">表情或动作</option>
        </select></label>}
        {use === "reaction" && <>
          <div className="facing-choices">{FACING_REACTIONS.map(item => <button type="button" key={item} className="facing-small" onClick={() => setName(item)}>{item}</button>)}</div>
          <label>播放时长（秒）<input type="number" min={1} max={30} value={duration} onChange={event => setDuration(Math.max(1, Math.min(30, Number(event.target.value) || 1)))} /></label>
        </>}
        <div className="facing-form-layout">
          <label>横向位置<input type="range" min={0} max={100} value={layout.x ?? layoutDefaults.x} onChange={event => setLayout({ ...layout, x: +event.target.value })} /></label>
          <label>纵向位置<input type="range" min={0} max={100} value={layout.y ?? layoutDefaults.y} onChange={event => setLayout({ ...layout, y: +event.target.value })} /></label>
          <label>缩放<input type="range" min={category === "scene" ? 100 : 40} max={180} value={layout.scale ?? layoutDefaults.scale} onChange={event => setLayout({ ...layout, scale: +event.target.value })} /></label>
        </div>
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
        <label>出图方式<select aria-label="出图方式" value={reference} onChange={event => setReference(event.target.value)}>
          <option value="text">文字生成</option>
          {currentPortrait && !currentPortrait.mediaType.startsWith("video/") && <option value="portrait">参考当前待机立绘</option>}
          {character.avatar && <option value="avatar">参考角色头像</option>}
          <option value="file">上传参考图</option>
        </select></label>
        {reference === "file" && <label>参考图<input type="file" accept="image/*" onChange={event => setReferenceFile(event.target.files?.[0])} /></label>}
        <label>画面描述<textarea value={description} onChange={event => setDescription(event.target.value)} rows={4} required /></label>
        <button className="facing-primary" disabled={busy || !description.trim()}>{busy ? "正在生成…" : candidate ? "再生成一张" : "生成预览"}</button>
        {candidate && <>
          <div className="facing-material-preview"><FacingMedia url={candidate.url} mediaType={candidate.mediaType} name="候选素材" /></div>
          <div className="facing-pair">
            {category === "portrait" && <button type="button" className="facing-soft" disabled={busy} onClick={() => void removeBackground()}>去底</button>}
            <button type="button" className="facing-primary" disabled={busy} onClick={() => setView("edit")}>使用这张</button>
          </div>
        </>}
      </form>}
      {error && <p className="facing-error" role="alert">{error}</p>}
    </main>
    {view === "add" && <div className="facing-overlay" onClick={reset}>
      <section className="facing-sheet" role="dialog" aria-modal="true" aria-label="添加素材" onClick={event => event.stopPropagation()}>
        <header><h2>添加{category === "portrait" ? "立绘" : "场景"}</h2><button type="button" onClick={reset}>完成</button></header>
        <div className="facing-list">
          <button type="button" onClick={() => upload.current?.click()}>从手机导入<ChevronRight size={16} /></button>
          <button type="button" onClick={() => setView("vn")}>从漫卷资源选<ChevronRight size={16} /></button>
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
