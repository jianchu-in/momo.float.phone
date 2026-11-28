"use client";
import type { MapPackage } from "@/lib/facing-map-transfer";
import { MapSheet } from "./facing-map-panels";
export function MapTransferSheet({ name, selectedName, data, asTemplate, busy, onTemplate, onFile, onImport, onExport, onClose }: {
  name?: string; selectedName?: string; data?: MapPackage; asTemplate: boolean; busy: boolean;
  onTemplate: (value: boolean) => void; onFile: (file: File) => void; onImport: () => void;
  onExport: (place: boolean) => void; onClose: () => void;
}) {
  return <MapSheet title="地图导入导出" onClose={onClose}>
    {name && <><h3>导出地图</h3><p>包含地图原图、图块位置与尺寸、地点描述、入口和全部内部地图。动向、私聊邀请和见面记录保留在本机。</p>
      <button type="button" className="facing-soft" disabled={busy} onClick={() => onExport(false)}>导出整个大地图 · {name}</button>
      {selectedName && <button type="button" className="facing-soft" disabled={busy} onClick={() => onExport(true)}>导出详细地点 · {selectedName}</button>}
    </>}
    <h3>导入地图或模板</h3><label>选择地图 JSON 文件<input type="file" accept=".json,application/json" disabled={busy} onChange={event => {
      const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) onFile(file);
    }} /></label>
    <p className="fmap-note">整图导入会新建一张地图。详细地点可导入模板列表，之后选择应用位置。</p>
    {data && <><p><strong>{data.name}</strong> · {data.pages.length} 张地图 · {data.pages.reduce((count, page) => count + page.tiles.length, 0)} 个图块 · {data.pages.reduce((count, page) => count + page.places.length, 0)} 个地点</p>
      <label className="fmap-check"><input type="checkbox" checked={asTemplate} disabled={busy || data.kind !== "atlas"} onChange={event => onTemplate(event.target.checked)} />导入为场所模板，保存到模板列表</label>
      <button type="button" className="facing-primary" disabled={busy} onClick={onImport}>{asTemplate ? "确认导入场所模板" : "确认导入为新地图"}</button>
    </>}
  </MapSheet>;
}
