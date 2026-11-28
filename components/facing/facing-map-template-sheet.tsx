"use client";
import { useEffect, useState } from "react";
import { loadCustomMapTemplates, deleteCustomMapTemplate, exportCustomMapTemplate } from "@/lib/facing-map-transfer";
import { getThemeAssetMap } from "@/lib/theme-storage";
import { downloadFile } from "@/lib/download-utils";
import { mapImageBounds } from "@/lib/facing-map-viewport";
import { Download } from "lucide-react";
import { BUILTIN_MAP_TEMPLATES, isEmptyMapPage, type MapTemplateTarget } from "@/lib/facing-map-templates";
import type { FacingAtlas, FacingMapPage } from "@/lib/facing-map-storage";
import { MapSheet } from "./facing-map-panels";

export function MapTemplateSheet({ atlas, page, selectedId, busy, onApply, onClose, onImport }: {
  atlas: FacingAtlas; page: FacingMapPage; selectedId?: string; busy: boolean;
  onApply: (id: string, target: MapTemplateTarget) => void; onClose: () => void; onImport: () => void;
}) {
  const [templateId, setTemplateId] = useState(() => /家|公寓|住所/.test(page.places.find(item => item.id === selectedId)?.name ?? page.name) ? "apartment" : "mall");
  const [target, setTarget] = useState(() => selectedId ? `place:${selectedId}` : isEmptyMapPage(page) ? "page" : "new");
  const [name, setName] = useState("");
  const [pointKey, setPointKey] = useState<string>();
  const [customs, setCustoms] = useState(loadCustomMapTemplates);
  const [images, setImages] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [deleteId, setDeleteId] = useState("");
  const [working, setWorking] = useState(false);
  const mediaIds = customs.flatMap(item => item.pages.flatMap(page => page.tiles.map(tile => tile.mediaId)));
  const mediaKey = mediaIds.join("|");
  useEffect(() => { let active = true; void getThemeAssetMap(mediaIds).then(value => { if (active) setImages(value); }); return () => { active = false; }; }, [mediaKey]);
  const custom = customs.find(item => `custom:${item.id}` === templateId);
  const customPage = custom?.pages.find(page => page.parentPlaceId === custom.rootPlace?.id);
  const bounds = customPage ? mapImageBounds(customPage) : undefined;
  const template = custom ? { id: `custom:${custom.id}`, name: custom.name, summary: custom.description, image: "", thumbnail: images[customPage?.tiles[0]?.mediaId ?? ""] ?? "",
    places: (customPage?.places ?? []).map(place => ({ ...place, key: place.id, x: (place.x - bounds!.x) / bounds!.width * 100, y: (place.y - bounds!.y) / bounds!.height * 100 })) }
    : BUILTIN_MAP_TEMPLATES.find(item => item.id === templateId)!;
  async function exportCustom() {
    if (!custom) return; setWorking(true); setError("");
    try { const data = await exportCustomMapTemplate(custom, new AbortController().signal); await downloadFile(new Blob([JSON.stringify(data)], { type: "application/json" }), `${custom.name.replace(/[\\/:*?"<>|]/g, "_")}-场所模板.json`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "导出失败。"); } finally { setWorking(false); }
  }
  const point = template.places.find(item => item.key === pointKey);
  const occupied = target.startsWith("place:") && atlas.pages.some(item => item.parentPlaceId === target.slice(6) && !isEmptyMapPage(item));
  function apply() {
    const location: MapTemplateTarget = target === "page" ? { type: "page", pageId: page.id }
      : target === "new" ? { type: "new", pageId: page.id, name: name.trim() || template.name }
      : { type: "place", placeId: target.slice(6) };
    onApply(template.id, location);
  }
  return <MapSheet title="详细场所模板" onClose={onClose}>
    <p className="fmap-note">底图和地点已配好，直接使用。不会调用文字或生图 API，已有地图不会被覆盖。</p>
    <div className="fmap-template-grid">{BUILTIN_MAP_TEMPLATES.map(item => <button type="button" key={item.id}
      aria-pressed={templateId === item.id} disabled={busy} onClick={() => { setTemplateId(item.id); setPointKey(undefined); }}>
      <img src={item.thumbnail} alt="" loading="lazy" /><strong>{item.name}</strong><small>{item.places.length} 个地点</small>
    </button>)}</div>
    {customs.length > 0 && <><h3>导入的场所模板</h3><div className="fmap-template-grid">{customs.map(item => {
      const first = item.pages.find(page => page.parentPlaceId === item.rootPlace?.id)?.tiles[0];
      return <button type="button" key={item.id} aria-pressed={templateId === `custom:${item.id}`} disabled={busy || working} onClick={() => { setTemplateId(`custom:${item.id}`); setPointKey(undefined); setDeleteId(""); }}>
        {first && images[first.mediaId] && <img src={images[first.mediaId]} alt="" />}<strong>{item.name}</strong><small>{item.pages.length} 张内部地图</small></button>;
    })}</div></>}
    <button type="button" className="facing-small" disabled={busy || working} onClick={onImport}>导入场所模板</button>
    <p>{template.summary}</p>
    <div className="fmap-template-preview">
      {customPage && bounds ? <svg viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`} role="img" aria-label={`${template.name}点位预览`}>
        {[...customPage.tiles].reverse().map(tile => images[tile.mediaId] && <image key={tile.id} href={images[tile.mediaId]} x={tile.x} y={tile.y} width={tile.width} height={tile.height} preserveAspectRatio="none" />)}
      </svg> : <img src={template.thumbnail} alt={`${template.name}点位预览`} />}
      {template.places.map((item, index) => <button type="button" key={item.key} aria-label={`预览${item.name}`}
        aria-pressed={pointKey === item.key} onClick={() => setPointKey(item.key)} style={{ left: `${item.x}%`, top: `${item.y}%` }}>{index + 1}</button>)}
    </div>
    <div className="facing-choices">{template.places.map((item, index) => <button type="button" key={item.key} className="facing-small"
      aria-pressed={pointKey === item.key} onClick={() => setPointKey(item.key)}>{index + 1}. {item.name}</button>)}</div>
    {point && <p className="fmap-note"><strong>{point.name}</strong> · {point.description}</p>}
    {!custom && <a className="facing-small fmap-template-download" href={template.image} download={`${template.name}.png`}><Download size={14} />下载模板原图</a>}
    {custom && <div className="facing-choices"><button type="button" className="facing-small" disabled={busy || working} onClick={() => void exportCustom()}>导出此场所模板</button><button type="button" className="facing-small facing-delete" disabled={busy || working} onClick={() => setDeleteId(custom.id)}>删除导入的模板</button></div>}
    {custom && deleteId === custom.id && <div className="fmap-delete-confirm"><p>只删除模板列表中的此项，已应用的地图会保留。</p><button type="button" className="facing-small facing-delete" disabled={busy || working} onClick={() => { setWorking(true); void deleteCustomMapTemplate(custom.id).then(() => { setCustoms(loadCustomMapTemplates()); setTemplateId("mall"); setDeleteId(""); }).catch(cause => setError(String(cause))).finally(() => setWorking(false)); }}>确认删除模板</button></div>}
    {error && <p className="facing-error" role="alert">{error}</p>}
    <label>应用位置<select value={target} disabled={busy} onChange={event => setTarget(event.target.value)}>
      {isEmptyMapPage(page) && <option value="page">当前空白地图 · {page.name}</option>}
      <option value="new">在当前地图新增模板地点</option>
      {page.places.map(item => <option key={item.id} value={`place:${item.id}`}>作为「{item.name}」的内部地图</option>)}
    </select></label>
    {target === "new" && <label>新地点名称<input value={name} placeholder={template.name} disabled={busy} maxLength={40} onChange={event => setName(event.target.value)} /></label>}
    {occupied && <p className="facing-error">这个地点已有内部地图。请选择其他地点，或新增一个模板地点。</p>}
    <button type="button" className="facing-primary" disabled={busy || working || occupied} onClick={apply}>{busy ? "正在加入模板…" : "使用这套模板"}</button>
  </MapSheet>;
}
