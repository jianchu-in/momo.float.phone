"use client";

import { useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { loadMapPreferences, saveMapPreferences, type MapPreferences, type FacingMapPage } from "@/lib/facing-map-storage";
import { getThemeAssetMap } from "@/lib/theme-storage";
import { extensionPosition, type MapExtension } from "@/lib/facing-map-engine";

export function MapSheet({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return <div className="facing-overlay fmap-overlay" onClick={onClose}>
    <section className="facing-sheet fmap-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={event => event.stopPropagation()}>
      <header><h2>{title}</h2><button type="button" className="facing-icon" aria-label="关闭弹窗" onClick={onClose}><X size={18} /></button></header>
      {children}
    </section>
  </div>;
}

export function FacingMapSettings({ onBack }: { onBack: () => void }) {
  const [settings, setSettings] = useState(loadMapPreferences);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    if (![settings.width, settings.height].every(value => Number.isSafeInteger(value) && value > 0)) { setError("请填写有效的图片宽高。"); return; }
    setBusy(true); setError("");
    try { await saveMapPreferences(settings); onBack(); }
    catch { setError("设置保存失败，请重试。"); }
    finally { setBusy(false); }
  }
  return <>
    <header className="facing-header"><button type="button" className="facing-back" aria-label="返回" onClick={onBack}>‹</button><h1>地图设置</h1></header>
    <main className="facing-scroll facing-form">
      <label>文字描述额外提示词<textarea aria-label="文字描述额外提示词" value={settings.descriptionPrompt} onChange={event => setSettings({ ...settings, descriptionPrompt: event.target.value })}
        placeholder="例如依照世界书保留旧城区，住宅集中在河边。" /></label>
      <label>生图额外提示词<textarea aria-label="生图额外提示词" value={settings.imagePrompt} onChange={event => setSettings({ ...settings, imagePrompt: event.target.value })}
        placeholder="例如低饱和半俯视地图，建筑轮廓简洁。" /></label>
      <MapDimensions value={settings} onChange={patch => setSettings({ ...settings, ...patch })} />
      <p className="fmap-note">大地图默认方形，内部地图默认横向。尺寸需受所选生图接口支持；每次生成前都可以临时修改。</p>
      {error && <p role="alert" className="facing-error">{error}</p>}
      <button type="button" className="facing-primary" disabled={busy} onClick={() => void save()}>保存地图设置</button>
    </main>
  </>;
}
export function MapDimensions({ value, onChange }: { value: Pick<MapPreferences, "width" | "height">; onChange: (patch: Pick<MapPreferences, "width" | "height">) => void }) {
  return <>
    <label>图片比例<select value="custom" onChange={event => {
      const [width, height] = event.target.value.split("x").map(Number);
      if (width && height) onChange({ width, height });
    }}>
      <option value="custom">自定义 · {value.width} × {value.height}</option>
      <option value="1024x1024">1:1 方形</option><option value="1536x1152">4:3 横向</option>
      <option value="1152x1536">3:4 竖向</option><option value="1536x864">16:9 横屏</option><option value="864x1536">9:16 竖屏</option>
    </select></label>
    <div className="facing-pair"><label>宽度（像素）<input type="number" min={1} value={value.width}
      onChange={event => onChange({ ...value, width: +event.target.value })} /></label>
      <label>高度（像素）<input type="number" min={1} value={value.height}
        onChange={event => onChange({ ...value, height: +event.target.value })} /></label></div>
  </>;
}

export function MapExpansionPreview({ page, source, extension }: { page: FacingMapPage; source: string; extension: MapExtension }) {
  const [images, setImages] = useState<Record<string, string>>({});
  const [height, setHeight] = useState(1000);
  useEffect(() => {
    let active = true;
    void getThemeAssetMap(page.tiles.map(tile => tile.mediaId)).then(result => { if (active) setImages(result); });
    const image = new Image();
    image.onload = () => { if (active && image.naturalWidth) setHeight(1000 * image.naturalHeight / image.naturalWidth); };
    image.src = source;
    return () => { active = false; image.onload = null; };
  }, [page, source]);
  const position = extensionPosition(extension.tile, extension.direction, 1000, height);
  const x = Math.min(position.x, ...page.tiles.map(tile => tile.x));
  const y = Math.min(position.y, ...page.tiles.map(tile => tile.y));
  const width = Math.max(position.x + 1000, ...page.tiles.map(tile => tile.x + tile.width)) - x;
  const totalHeight = Math.max(position.y + height, ...page.tiles.map(tile => tile.y + tile.height)) - y;
  return <svg className="fmap-candidate" viewBox={`${x} ${y} ${width} ${totalHeight}`} role="img" aria-label="新旧地图拼接预览">
    <image href={source} x={position.x} y={position.y} width={1000} height={height} preserveAspectRatio="none" />
    {[...page.tiles].reverse().map(tile => images[tile.mediaId] && <image key={tile.id} href={images[tile.mediaId]}
      x={tile.x} y={tile.y} width={tile.width} height={tile.height} preserveAspectRatio="none" />)}
    <rect x={position.x} y={position.y} width={1000} height={height} fill="none" stroke="#72896c" strokeWidth={4} strokeDasharray="12 8" />
  </svg>;
}
