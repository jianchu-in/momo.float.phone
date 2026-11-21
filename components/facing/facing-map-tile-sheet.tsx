"use client";
import { useEffect, useState } from "react";
import { getThemeAssetMap } from "@/lib/theme-storage";
import { placesForTile } from "@/lib/facing-map-editing";
import type { FacingMapPage, MapTile } from "@/lib/facing-map-storage";
import { MapSheet } from "./facing-map-panels";
import type { MapExtension } from "@/lib/facing-map-engine";

export function MapTileSheet({ page, selectedId, busy, onSelect, onSave, onRemove, onRegenerate, onDrag, onDownload, onExpand, onCalibrate, onClose }: {
  page: FacingMapPage; selectedId?: string; busy: boolean; onSelect: (id: string) => void;
  onSave: (tile: MapTile, order?: "front" | "back") => void; onRemove: (id: string, places: boolean) => void;
  onRegenerate: (tile: MapTile) => void; onDrag: (id: string) => void; onDownload: (tile: MapTile) => void;
  onExpand: (direction: MapExtension["direction"]) => void; onCalibrate: () => void; onClose: () => void;
}) {
  const [images, setImages] = useState<Record<string, string>>({});
  const ids = page.tiles.map(tile => tile.mediaId).join("|");
  useEffect(() => { let active = true; void getThemeAssetMap(page.tiles.map(tile => tile.mediaId)).then(value => { if (active) setImages(value); }); return () => { active = false; }; }, [ids]);
  const selected = page.tiles.find(tile => tile.id === selectedId) ?? page.tiles[0];
  return <MapSheet title="图块与扩展" onClose={onClose}>
    <div className="facing-choices">{(["left", "right", "top", "bottom"] as const).map(direction => <button key={direction} type="button" className="facing-small"
      disabled={busy || !page.tiles.length} onClick={() => onExpand(direction)}>向{{ left: "左", right: "右", top: "上", bottom: "下" }[direction]}扩展</button>)}</div>
    <div className="fmap-template-grid">{page.tiles.map((tile, index) => <button type="button" key={tile.id} aria-pressed={selected?.id === tile.id} disabled={busy} onClick={() => onSelect(tile.id)}>
      {images[tile.mediaId] && <img src={images[tile.mediaId]} alt="" />}<strong>{tile.name || `图块 ${index + 1}`}</strong><small>{tile.pixelWidth} × {tile.pixelHeight} 像素</small>
    </button>)}</div>
    {selected ? <TileEditor key={`${selected.id}:${selected.mediaId}`} tile={selected} page={page} busy={busy} onSave={onSave} onRemove={onRemove}
      onRegenerate={onRegenerate} onDrag={onDrag} onDownload={onDownload} /> : <p>先上传图片或生成地图，即可管理图块。</p>}
    <button type="button" className="facing-soft" disabled={busy || !page.tiles.length || !page.places.length} onClick={onCalibrate}>AI 校准地点 · 识图API</button>
  </MapSheet>;
}
function TileEditor({ tile, page, busy, onSave, onRemove, onRegenerate, onDrag, onDownload }: {
  tile: MapTile; page: FacingMapPage; busy: boolean; onSave: (tile: MapTile, order?: "front" | "back") => void;
  onRemove: (id: string, places: boolean) => void; onRegenerate: (tile: MapTile) => void; onDrag: (id: string) => void; onDownload: (tile: MapTile) => void;
}) {
  const [draft, setDraft] = useState(tile), [locked, setLocked] = useState(true), [deleting, setDeleting] = useState(false), [removePlaces, setRemovePlaces] = useState(false);
  const [neighbor, setNeighbor] = useState(page.tiles.find(item => item.id !== tile.id)?.id ?? "");
  const valid = [draft.x, draft.y, draft.width, draft.height].every(Number.isFinite) && draft.width > 0 && draft.height > 0;
  const owned = placesForTile(page, tile.id).length;
  function size(axis: "width" | "height", value: number) {
    const other = axis === "width" ? "height" : "width";
    const ratio = draft[axis] > 0 && draft[other] > 0 ? draft[other] / draft[axis] : tile[other] / tile[axis];
    setDraft({ ...draft, [axis]: value, ...(locked ? { [other]: value * ratio } : {}) });
  }
  return <fieldset className="fmap-tile-editor" disabled={busy}>
    <legend>编辑所选图块</legend>
    <label>图块名称<input value={draft.name ?? ""} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
    <label>图块描述<textarea aria-label="图块描述" value={draft.description ?? ""} placeholder="为这块地图单独保存场景和布局描述。" onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>
    <div className="facing-pair">{(["x", "y"] as const).map(axis => <label key={axis}>{axis.toUpperCase()} 坐标<input type="number" value={draft[axis]} onChange={event => setDraft({ ...draft, [axis]: +event.target.value })} /></label>)}</div>
    <div className="facing-pair">{(["width", "height"] as const).map(axis => <label key={axis}>地图{axis === "width" ? "宽度" : "高度"}<input type="number" min={1} value={Math.round(draft[axis] * 100) / 100} onChange={event => size(axis, +event.target.value)} /></label>)}</div>
    <label className="fmap-check"><input type="checkbox" checked={locked} onChange={event => setLocked(event.target.checked)} />锁定宽高比例</label>
    <p className="fmap-note">坐标和宽高使用地图单位。{owned} 个关联地点会同步移动和缩放，原图像素保持原样；画面细节可通过重新生图更新。</p>
    <div className="facing-choices">{[1.5, 2].map(area => <button key={area} type="button" className="facing-small" onClick={() => setDraft({ ...draft, width: draft.width * Math.sqrt(area), height: draft.height * Math.sqrt(area) })}>面积 ×{area}</button>)}</div>
    {page.tiles.length > 1 && <>
      <label>对齐到图块<select value={neighbor} onChange={event => setNeighbor(event.target.value)}>{page.tiles.filter(item => item.id !== tile.id).map((item, index) => <option key={item.id} value={item.id}>{item.name || `其他图块 ${index + 1}`}</option>)}</select></label>
      <div className="facing-choices">{(["left", "right", "top", "bottom"] as const).map(direction => <button type="button" className="facing-small" key={direction} onClick={() => {
        const other = page.tiles.find(item => item.id === neighbor); if (!other) return;
        setDraft({ ...draft, x: direction === "left" ? other.x - draft.width : direction === "right" ? other.x + other.width : other.x,
          y: direction === "top" ? other.y - draft.height : direction === "bottom" ? other.y + other.height : other.y });
      }}>放到{{ left: "左侧", right: "右侧", top: "上方", bottom: "下方" }[direction]}</button>)}</div>
    </>}
    <button type="button" className="facing-primary" disabled={!valid} onClick={() => onSave(draft)}>保存图块修改</button>
    <div className="facing-choices">
      <button type="button" className="facing-small" onClick={() => onDrag(tile.id)}>在地图中拖动</button>
      <button type="button" className="facing-small" disabled={!valid} onClick={() => onRegenerate(draft)}>润色描述 / 重新生图</button>
      <button type="button" className="facing-small" onClick={() => onDownload(tile)}>下载图块原图</button>
      <button type="button" className="facing-small" disabled={!valid} onClick={() => onSave(draft, "front")}>移到最上层</button>
      <button type="button" className="facing-small" disabled={!valid} onClick={() => onSave(draft, "back")}>移到最下层</button>
    </div>
    {!deleting ? <button type="button" className="facing-link facing-delete" onClick={() => setDeleting(true)}>删除这个图块</button> : <div className="fmap-delete-confirm">
      <p>删除这张地图图片？默认保留地点和内部地图。</p>
      <label className="fmap-check"><input type="checkbox" checked={removePlaces} onChange={event => setRemovePlaces(event.target.checked)} />同时删除 {owned} 个关联地点及其内部地图</label>
      <div className="facing-choices"><button type="button" className="facing-small facing-delete" onClick={() => onRemove(tile.id, removePlaces)}>确认删除图块</button><button type="button" className="facing-small" onClick={() => setDeleting(false)}>取消删除</button></div>
    </div>}
  </fieldset>;
}
