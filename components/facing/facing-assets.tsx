"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Plus, Trash2 } from "lucide-react";
import type { Character } from "@/lib/character-types";
import { ConfirmDialog } from "@/components/ui/modal";
import { downloadFile } from "@/lib/download-utils";
import { loadDwellingLayout } from "@/lib/dwelling-storage";
import { loadMediaBlob } from "@/lib/media-cache-storage";
import { getThemeAssetDataUrl } from "@/lib/theme-storage";
import { getChatImageFromIndexedDB } from "@/lib/chat-asset-storage";
import { loadVnScenes, loadVnSprites, type VnAssetLayout } from "@/lib/vn-asset-storage";
import { analyzeSceneImage } from "@/lib/scene-image-analysis";
import { generateImageFromConfiguredApi, resolveConfiguredImageGenerationSettings } from "@/lib/image-generation-service";
import { FACING_IMAGE_LOCATIONS, FACING_MEDIA_ACCEPT, FACING_REACTIONS, facingAssetLocation, facingId, facingMediaType,
  groupFacingScenes, saveFacingAsset, setFacingAssetMotion, setFacingScenePortraits, updateFacingAsset,
  type FacingAsset, type FacingSceneGroup } from "@/lib/facing-storage";
import { FacingMedia, FacingStage, useFacingMediaUrl } from "./facing-stage";
import { FacingLegacyAssets } from "./facing-legacy-assets";

type Draft = { asset?: FacingAsset; category: "scene" | "portrait"; name: string; folder: string; layout: VnAssetLayout; portraitIds: string[]; motion?: File; candidate?: { blob: Blob; url: string; mediaType: string } };
function Tile({ asset, onOpen, selected, onSelect }: { asset: FacingAsset; onOpen: () => void; selected?: boolean; onSelect?: () => void }) {
  const url = useFacingMediaUrl(asset);
  return <div className="facing-library-tile"><button className="facing-asset-tile" onClick={onOpen}><span className="facing-thumb">{url ? <FacingMedia url={url} mediaType={asset.mediaType} name={asset.name} /> : <ImagePlus size={24} />}</span><span>{asset.name}</span></button>
    {onSelect && <label className="facing-library-select"><input type="checkbox" aria-label={`选择素材${asset.name}`} checked={selected} onChange={onSelect} />选择</label>}</div>;
}
function PortraitFolders({ assets, open, selection, select, prefix = "" }: { assets: FacingAsset[]; open: (asset: FacingAsset) => void; selection: Set<string>; select: (id: string) => void; prefix?: string }) {
  const own = assets.filter(asset => (asset.folder?.trim() || "未分类") === (prefix || "未分类"));
  const folders = [...new Set(assets.map(asset => asset.folder?.trim() || "未分类").filter(path => prefix ? path.startsWith(prefix + "/") : path !== "未分类").map(path => prefix ? path.slice(prefix.length + 1).split("/")[0] : path.split("/")[0]))];
  return <>{!!own.length && <div className="facing-grid">{own.map(asset => <Tile key={asset.id} asset={asset} onOpen={() => open(asset)} selected={selection.has(asset.id)} onSelect={() => select(asset.id)} />)}</div>}
    {folders.map(folder => { const path = prefix ? prefix + "/" + folder : folder; return <details className="facing-portrait-folder" key={path} open><summary>{folder}</summary><PortraitFolders assets={assets} open={open} selection={selection} select={select} prefix={path} /></details>; })}</>;
}
export function FacingAssets({ character, assets, groups, onBack, onChange, onDelete }: { character: Character; assets: FacingAsset[]; groups: FacingSceneGroup[]; onBack: () => void; onChange: () => void; onDelete: (ids: readonly string[]) => Promise<void> }) {
  const [draft, setDraft] = useState<Draft>();
  const [binding, setBinding] = useState<{ location: string; ids: string[] }>();
  const [legacy, setLegacy] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [selected, setSelected] = useState(new Set<string>()), [deleting, setDeleting] = useState<string[]>();
  const [moveFolder, setMoveFolder] = useState(""), [description, setDescription] = useState("");
  const [importing, setImporting] = useState<"vn" | "dwelling">(), [dwelling, setDwelling] = useState<{ name: string; blob: Blob }[]>([]);
  const control = useRef<AbortController | null>(null);
  const sprites = assets.filter(item => item.category === "portrait" && item.composition !== "full" && !item.generated);
  const old = assets.filter(item => item.composition === "full" && !item.generated);
  const generated = assets.filter(item => item.generated);
  const editedUrl = useFacingMediaUrl(draft?.asset, true);
  const scene = groups.find(group => group.name === draft?.name)?.backdrop;
  useEffect(() => () => control.current?.abort(), []);
  useEffect(() => () => { if (draft?.candidate?.url.startsWith("blob:")) URL.revokeObjectURL(draft.candidate.url); }, [draft?.candidate?.url]);
  function open(asset?: FacingAsset, category: Draft["category"] = "portrait") {
    setError(""); setDescription("");
    setDraft({ asset, category: asset?.category ?? category, name: asset?.name ?? (category === "scene" ? "客厅" : "默认"), folder: asset?.folder ?? "", layout: asset?.layout ?? {}, portraitIds: asset?.portraitIds ?? [] });
  }
  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (control.current) return;
    const c = new AbortController(); control.current = c; setBusy(true); setError("");
    try { await action(c.signal); } catch (cause) { if (!c.signal.aborted) setError(cause instanceof Error ? cause.message : "操作失败，请重试。"); }
    finally { control.current = null; setBusy(false); }
  }
  function loadCandidate(blob: Blob, name = "") {
    const type = facingMediaType(blob, name);
    if (!draft || !type) { setError("请选择图片、GIF、动图或视频。"); return; }
    if (draft.category === "scene" && (type.startsWith("video/") || /gif|apng/.test(type))) { setError("背景请选择静态图片；GIF、动图和视频请放到立绘素材。"); return; }
    setDraft({ ...draft, candidate: { blob, url: URL.createObjectURL(blob), mediaType: type } }); setImporting(undefined);
  }
  async function save() {
    if (!draft?.name.trim()) { setError("请填写素材名称。"); return; }
    await run(async () => {
      if (!draft.asset && !draft.candidate) throw new Error("请先上传或生成素材。");
      const changes = { characterId: character.id, category: draft.category, name: draft.name.trim(), folder: draft.category === "portrait" ? draft.folder.split("/").map(p => p.trim()).filter(Boolean).join("/") : undefined,
        use: draft.category === "scene" ? "scene" as const : draft.name.trim() === "默认" ? "idle" as const : "reaction" as const,
        durationMs: draft.asset?.durationMs ?? 3500, layout: draft.layout, location: draft.category === "scene" ? draft.name.trim() : undefined, portraitIds: draft.category === "scene" ? draft.portraitIds : undefined };
      let saved: FacingAsset;
      if (draft.asset) { saved = { ...draft.asset, ...changes }; await updateFacingAsset(saved); }
      else saved = await saveFacingAsset({ ...changes, id: facingId() }, draft.candidate!.blob, draft.candidate!.mediaType);
      onChange(); setDraft({ ...draft, asset: saved, candidate: undefined });
      if (draft.motion) { saved = await setFacingAssetMotion(saved, draft.motion); onChange(); }
      setDraft(undefined);
    });
  }
  async function generate(polish = false) {
    if (!draft) return;
    await run(async signal => {
      const instruction = draft.category === "scene" ? `场所「${draft.name}」的纯环境背景，不出现人物、立绘、文字或UI。` : `角色「${character.name}」的独立立绘，情绪「${draft.name}」。完整人物、自然姿态，透明背景，不包含场景、文字或UI。`;
      if (polish) {
        const result = await analyzeSceneImage<{ description?: string }>({ characterId: character.id, characterName: character.name, appId: "facing", task: "plan", signal,
          instructions: '按用户要求润色素材画面描述，人物立绘与场景背景分别描述，不混成整图。只返回JSON {"description":"画面描述"}。', context: JSON.stringify({ 任务: instruction, 人设: character.persona, 原描述: description }) });
        if (!result?.description?.trim()) throw new Error("没有生成有效描述。"); setDescription(result.description); return;
      }
      const config = resolveConfiguredImageGenerationSettings(character.id, "facing");
      const reference = config.characterReferences?.[character.id];
      const role = draft.category === "portrait" && config.provider !== "novelai" ? (reference?.enabled !== false && reference?.assetId ? await getChatImageFromIndexedDB(reference.assetId) : null) || character.avatar : undefined;
      const result = await generateImageFromConfiguredApi({ characterId: character.id, appId: "facing", description: [instruction, description].join("\n"), explicitReferenceImage: role || undefined, referenceSelection: { character: false, user: false }, portraitOutput: true, signal });
      if (!result) throw new Error("请先为面对面启用并绑定生图配置。");
      if (!signal.aborted) setDraft(current => current ? { ...current, candidate: { blob: result.blob, url: result.dataUrl, mediaType: facingMediaType(result.blob) || "image/png" } } : current);
    });
  }
  async function importMedia(mediaId: string, name: string) {
    await run(async () => { const url = await getThemeAssetDataUrl(mediaId); if (!url) throw new Error("原素材不存在。"); loadCandidate(await (await fetch(url)).blob(), name); });
  }
  function select(id: string) { setSelected(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  if (legacy) return <FacingLegacyAssets character={character} assets={old} groups={groupFacingScenes(old)} onBack={() => setLegacy(false)} onChange={onChange} onDelete={onDelete} />;
  const url = draft?.candidate?.url ?? editedUrl, type = draft?.candidate?.mediaType ?? draft?.asset?.motionMediaType ?? draft?.asset?.mediaType ?? "image/png";
  return <>
    <header className="facing-header"><button className="facing-back" aria-label="返回" disabled={busy} onClick={() => draft ? (setDraft(undefined), setImporting(undefined), setError("")) : onBack()}>‹</button><h1>{draft ? draft.category === "scene" ? "场景背景" : "立绘素材" : "素材库"}</h1></header>
    <main className="facing-scroll">
      {!draft ? <>
        <section className="facing-material-group"><div className="facing-row"><h2>场景素材</h2><button className="facing-small" onClick={() => open(undefined, "scene")}><Plus size={15} />添加场景背景</button></div>
          <p className="facing-auto-help">背景只在切换场所时改变；为每个场所选择可复用的立绘。</p>
          {groups.filter(group => group.backdrop).map(group => <section key={group.name} className="facing-material-group"><div className="facing-row"><h3>{group.name}</h3><button className="facing-small" onClick={() => setBinding({ location: group.name, ids: group.backdrop!.portraitIds ?? sprites.map(item => item.id) })}>可用立绘 · {group.backdrop!.portraitIds?.length ?? sprites.length}</button></div><div className="facing-grid">{group.assets.filter(item => item.category === "scene").map(asset => <Tile key={asset.id} asset={asset} onOpen={() => open(asset)} selected={selected.has(asset.id)} onSelect={() => select(asset.id)} />)}</div></section>)}
          {!assets.some(item => item.category === "scene") && <p className="facing-empty">上传一张背景，再选择这个场所可使用的立绘。</p>}
        </section>
        <section className="facing-material-group"><div className="facing-row"><h2>立绘素材</h2><button className="facing-small" onClick={() => open()}><Plus size={15} />上传立绘／GIF／动图</button></div>
          <p className="facing-auto-help">默认和自定义情绪统一在这里命名。分类可用「日常/居家」这样的多级路径。</p>
          <PortraitFolders assets={sprites} open={open} selection={selected} select={select} />{!sprites.length && <p className="facing-empty">还没有立绘，推荐上传透明背景的PNG或GIF，才能与场景分层叠加。</p>}
        </section>
        {!!old.length && <button className="facing-soft" onClick={() => setLegacy(true)}>旧版整图素材 · {old.length}</button>}
        {!!generated.length && <details><summary>自动补图记录 · {generated.length}</summary><div className="facing-grid">{generated.slice(-8).map(asset => <Tile key={asset.id} asset={asset} onOpen={() => void run(async () => { const source = await getThemeAssetDataUrl(asset.mediaId); if (source) await downloadFile(await (await fetch(source)).blob(), `${asset.name}.png`); })} selected={selected.has(asset.id)} onSelect={() => select(asset.id)} />)}</div></details>}
        {!!selected.size && <div className="facing-form"><span>已选择 {selected.size} 项</span><label>移动立绘到分类<input value={moveFolder} onChange={event => setMoveFolder(event.target.value)} placeholder="例如 日常/居家" /></label><div className="facing-choices"><button className="facing-small" disabled={busy} onClick={() => void run(async () => { for (const asset of sprites.filter(item => selected.has(item.id))) await updateFacingAsset({ ...asset, folder: moveFolder.split("/").map(part => part.trim()).filter(Boolean).join("/") }); setSelected(new Set()); onChange(); })}>移动所选立绘</button><button className="facing-small facing-delete" onClick={() => setDeleting([...selected])}><Trash2 size={14} />删除所选</button><button className="facing-small" onClick={() => setSelected(new Set())}>取消选择</button></div></div>}
      </> : <div className="facing-form">
        {url && <div className="facing-layout-preview"><FacingStage draft={{ category: draft.category, name: draft.name, url, mediaType: type, layout: draft.layout }} scene={draft.category === "portrait" ? groups.find(group => group.backdrop)?.backdrop : undefined} portrait={draft.category === "scene" ? sprites[0] : undefined} name={character.name} /></div>}
        <label>{draft.category === "scene" ? "场所名称" : "立绘名称／情绪"}<input aria-label="素材名称" value={draft.name} list={draft.category === "scene" ? "facing-place-names" : "facing-mood-names"} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
        <datalist id="facing-place-names">{[...new Set([...FACING_IMAGE_LOCATIONS, ...groups.map(group => group.name)])].map(name => <option key={name} value={name} />)}</datalist>
        <datalist id="facing-mood-names">{["默认", ...FACING_REACTIONS].map(name => <option key={name} value={name} />)}</datalist>
        {draft.category === "portrait" && <label>立绘分类<input aria-label="立绘分类" value={draft.folder} onChange={event => setDraft({ ...draft, folder: event.target.value })} placeholder="例如 日常/居家" /></label>}
        {!draft.asset && <><label>{draft.category === "portrait" ? "上传立绘（支持GIF、动图和视频）" : "上传背景图片"}<input type="file" accept={draft.category === "portrait" ? FACING_MEDIA_ACCEPT : "image/png,image/jpeg,image/webp,image/avif"} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) loadCandidate(file, file.name); }} /></label>
          <div className="facing-choices"><button className="facing-small" onClick={() => setImporting("vn")}>从漫卷资源选</button>{draft.category === "scene" && <button className="facing-small" onClick={() => { setImporting("dwelling"); void run(async () => { const layout = await loadDwellingLayout(character.id); const items = await Promise.all((layout?.layout.rooms ?? []).map(async room => { const media = room.imageAssetId ? await loadMediaBlob(room.imageAssetId) : null; return media?.mimeType.startsWith("image/") ? { name: room.name, blob: media.blob } : null; })); setDwelling(items.filter((item): item is NonNullable<typeof item> => !!item)); }); }}>从角色栖所选</button>}</div>
          {importing === "vn" && <div className="facing-list">{(draft.category === "scene" ? loadVnScenes(character.id).map(item => ({ name: item.name, id: item.assetId })) : loadVnSprites(character.id).map(item => ({ name: item.key, id: item.assetId }))).map(item => <button key={item.id} onClick={() => void importMedia(item.id, item.name)}>{item.name}</button>)}</div>}
          {importing === "dwelling" && <div className="facing-list">{dwelling.map(item => <button key={item.name} onClick={() => { setDraft({ ...draft, name: item.name, candidate: { blob: item.blob, url: URL.createObjectURL(item.blob), mediaType: item.blob.type || "image/png" } }); setImporting(undefined); }}>{item.name}</button>)}{!dwelling.length && <p>暂无可用房间图。</p>}</div>}
          <label>AI画面描述<textarea aria-label="素材画面描述" value={description} onChange={event => setDescription(event.target.value)} /></label><div className="facing-choices"><button className="facing-small" disabled={busy} onClick={() => void generate(true)}>AI润色描述</button><button className="facing-small" disabled={busy} onClick={() => void generate()}>AI生成预览</button></div>
        </>}
        {draft.category === "portrait" && <label>配套GIF／动图（可选）<input type="file" accept="image/gif,image/apng,image/webp,image/png,video/mp4,video/webm,video/quicktime,.apng" onChange={event => { const motion = event.currentTarget.files?.[0]; event.currentTarget.value = ""; setDraft({ ...draft, motion }); }} />{draft.motion?.name}</label>}
        {draft.asset?.motionMediaId && <button className="facing-small" onClick={() => void run(async () => { const updated = await setFacingAssetMotion(draft.asset!, null); setDraft({ ...draft, asset: updated }); onChange(); })}>移除配套动图</button>}
        {(["x", "y", "scale"] as const).map(key => <label key={key}>{{ x: "横向位置", y: "纵向位置", scale: "缩放" }[key]}<input type="range" min={key === "scale" ? draft.category === "scene" ? 100 : 40 : 0} max={key === "scale" ? 180 : 100} value={draft.layout[key] ?? (key === "scale" ? 100 : key === "y" && draft.category === "portrait" ? 100 : 50)} onChange={event => setDraft({ ...draft, layout: { ...draft.layout, [key]: +event.target.value } })} /></label>)}
        {draft.category === "scene" && <fieldset><legend>这个场所可用的立绘（多选）</legend>{sprites.map(asset => <label key={asset.id} className="fmap-check"><input type="checkbox" checked={draft.portraitIds.includes(asset.id)} onChange={event => setDraft({ ...draft, portraitIds: event.target.checked ? [...draft.portraitIds, asset.id] : draft.portraitIds.filter(id => id !== asset.id) })} />{asset.folder && `${asset.folder} / `}{asset.name}</label>)}</fieldset>}
        <button className="facing-primary" disabled={busy} onClick={() => void save()}>保存素材</button>
        {draft.asset && <div className="facing-choices"><button className="facing-small" onClick={() => void run(async () => { const source = await getThemeAssetDataUrl(draft.asset!.mediaId); if (!source) throw new Error("原图不存在。"); const blob = await (await fetch(source)).blob(); await downloadFile(blob, `${draft.name}.${blob.type.split("/")[1] || "png"}`); })}>下载原素材</button><button className="facing-small facing-delete" onClick={() => setDeleting([draft.asset!.id])}>删除素材</button></div>}
      </div>}
      {busy && <p role="status">处理中…<button className="facing-small" onClick={() => control.current?.abort()}>停止</button></p>}{error && <p className="facing-error" role="alert">{error}</p>}
    </main>
    {binding && <div className="facing-overlay"><section className="facing-sheet" role="dialog" aria-label="场所可用立绘"><header><h2>{binding.location} · 可用立绘</h2><button disabled={busy} onClick={() => setBinding(undefined)}>取消</button></header><div className="facing-scroll">{sprites.map(asset => <label key={asset.id} className="fmap-check"><input type="checkbox" checked={binding.ids.includes(asset.id)} onChange={event => setBinding({ ...binding, ids: event.target.checked ? [...binding.ids, asset.id] : binding.ids.filter(id => id !== asset.id) })} />{asset.folder && `${asset.folder} / `}{asset.name}</label>)}<button className="facing-primary" disabled={busy} onClick={() => void run(async () => { await setFacingScenePortraits(character.id, binding.location, binding.ids); onChange(); setBinding(undefined); })}>保存场所立绘</button></div></section></div>}
    {deleting && <ConfirmDialog title="删除素材？" message={`删除选中的${deleting.length}项素材？`} confirmLabel="确认删除" onCancel={() => setDeleting(undefined)} onConfirm={() => void run(async () => { await onDelete(deleting); setDeleting(undefined); setSelected(new Set()); setDraft(undefined); onChange(); })} />}
  </>;
}
