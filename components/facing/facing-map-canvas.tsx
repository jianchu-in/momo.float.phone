"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { Character } from "@/lib/character-types";
import { getThemeAssetMap } from "@/lib/theme-storage";
import { mapImageBounds, coverMapView } from "@/lib/facing-map-viewport";
import { transformMapTile } from "@/lib/facing-map-editing";
import { mapBounds, placeOnMapPage, routePoint, type FacingAtlas, type FacingMapPage, type MapPoint, type MapSnapshot } from "@/lib/facing-map-storage";

export function FacingMapCanvas({ atlas, page, characters, snapshot, selectedId, editing, travel, userPlaceId, userAvatar, userName,
  onPlace, onPoint, onMove, tileEditing = false, selectedTileId, onTile, onTileMove }: {
  atlas: FacingAtlas; page: FacingMapPage; characters: Character[]; snapshot?: MapSnapshot; selectedId?: string;
  editing: boolean; tileEditing?: boolean; selectedTileId?: string; onTile?: (id: string) => void; onTileMove?: (id: string, point: MapPoint) => void;
  travel?: { paths: { character?: Character; points: MapPoint[]; progress: number }[]; dashed: boolean };
  userPlaceId?: string; userAvatar?: string; userName: string;
  onPlace: (id: string) => void; onPoint: (point: MapPoint) => void; onMove: (id: string, point: MapPoint) => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [images, setImages] = useState<Record<string, string>>({});
  const views = useRef(new Map<string, { x: number; y: number; scale: number }>());
  const [cover, setCover] = useState(false);
  const [movedTile, setMovedTile] = useState<{ id: string; point: MapPoint }>();
  const [viewport, setViewport] = useState({ width: 390, height: 600 });
  const [view, setView] = useState({ x: 0, y: 0, scale: .4 });
  const viewRef = useRef(view);
  const [movedPlace, setMovedPlace] = useState<{ id: string; point: MapPoint }>();
  const pointers = useRef(new Map<number, MapPoint>());
  const gesture = useRef<{ origin: MapPoint; view: typeof view; distance?: number; placeId?: string; tileId?: string; targetTileId?: string; targetId?: string; moved: boolean } | undefined>(undefined);
  const originalTile = page.tiles.find(tile => tile.id === movedTile?.id);
  const display = originalTile && movedTile ? transformMapTile(page, originalTile.id, { ...originalTile, ...movedTile.point }) : page;
  const bounds = mapBounds(display);
  const imageBounds = mapImageBounds(page);
  const ids = page.tiles.map(tile => tile.mediaId).join("|");
  const viewKey = `${page.id}:${cover ? "cover" : "fit"}`;
  const margin = 100 / view.scale;
  const visibleTiles = display.tiles.filter(tile => tile.x + tile.width >= -view.x / view.scale - margin
    && tile.x <= (viewport.width - view.x) / view.scale + margin
    && tile.y + tile.height >= -view.y / view.scale - margin
    && tile.y <= (viewport.height - view.y) / view.scale + margin);
  useEffect(() => {
    let active = true;
    void getThemeAssetMap(page.tiles.map(tile => tile.mediaId)).then(result => { if (active) setImages(result); });
    return () => { active = false; };
  }, [ids]);

  function apply(next: typeof view) {
    const rect = frame.current?.getBoundingClientRect();
    const constrained = cover && rect?.width && rect.height ? coverMapView(next, rect, imageBounds) : next;
    viewRef.current = constrained; views.current.set(viewKey, constrained); setView(constrained);
  }
  function fit() {
    const rect = frame.current?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return;
    const area = cover ? imageBounds : bounds;
    const scale = cover ? Math.max(rect.width / area.width, rect.height / area.height) : Math.min(rect.width / area.width, rect.height / area.height) * .9;
    apply({ scale, x: (rect.width - area.width * scale) / 2 - area.x * scale,
      y: (rect.height - area.height * scale) / 2 - area.y * scale });
  }
  useEffect(() => {
    let initialized = false;
    const measure = () => {
      const rect = frame.current?.getBoundingClientRect();
      if (!rect?.width || !rect.height) return;
      setViewport(previous => previous.width === rect.width && previous.height === rect.height ? previous : { width: rect.width, height: rect.height });
      if (!initialized) {
        initialized = true;
        const saved = views.current.get(viewKey);
        if (saved) apply(saved); else fit();
      } else if (cover) apply(viewRef.current);
    };
    measure();
    // A details panel or toolbar resizing must never reset the user's zoom or pan.
    const observer = new ResizeObserver(measure);
    if (frame.current) observer.observe(frame.current);
    return () => observer.disconnect();
  }, [viewKey, cover ? imageBounds.x : 0, cover ? imageBounds.y : 0, cover ? imageBounds.width : 0, cover ? imageBounds.height : 0]);
  const hadTiles = useRef(page.tiles.length > 0);
  useEffect(() => {
    if (!hadTiles.current && page.tiles.length) fit();
    hadTiles.current = page.tiles.length > 0;
  }, [page.id, page.tiles.length]);
  function local(event: { clientX: number; clientY: number }) {
    const rect = frame.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  function world(point: MapPoint) {
    const current = viewRef.current;
    return { x: (point.x - current.x) / current.scale, y: (point.y - current.y) / current.scale };
  }
  function zoom(factor: number, anchor?: MapPoint) {
    const rect = frame.current?.getBoundingClientRect();
    if (!rect) return;
    const at = anchor ?? { x: rect.width / 2, y: rect.height / 2 };
    const current = viewRef.current;
    const minimum = cover ? Math.max(rect.width / imageBounds.width, rect.height / imageBounds.height) : .05;
    const scale = Math.max(minimum, Math.min(Math.max(8, minimum * 8), current.scale * factor));
    const ratio = scale / current.scale;
    apply({ scale, x: at.x - (at.x - current.x) * ratio, y: at.y - (at.y - current.y) * ratio });
  }
  function down(event: PointerEvent<SVGSVGElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = local(event);
    pointers.current.set(event.pointerId, point);
    const tileId = (event.target as Element).closest("[data-tile]")?.getAttribute("data-tile") ?? undefined;
    const placeId = (event.target as Element).closest("[data-place]")?.getAttribute("data-place") ?? undefined;
    const values = [...pointers.current.values()];
    gesture.current = { origin: point, view: viewRef.current, moved: false, targetId: placeId, targetTileId: tileId, tileId: tileEditing ? tileId : undefined, placeId: editing && !tileEditing ? placeId : undefined };
    if (values.length === 2) gesture.current = { origin: { x: (values[0].x + values[1].x) / 2, y: (values[0].y + values[1].y) / 2 },
      distance: Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y), view: viewRef.current, moved: true };
  }
  function move(event: PointerEvent<SVGSVGElement>) {
    const previous = gesture.current;
    if (!pointers.current.has(event.pointerId) || !previous) return;
    const point = local(event);
    pointers.current.set(event.pointerId, point);
    const values = [...pointers.current.values()];
    if (values.length >= 2 && previous.distance) {
      const midpoint = { x: (values[0].x + values[1].x) / 2, y: (values[0].y + values[1].y) / 2 };
      const distance = Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y);
      const minimum = cover ? Math.max(viewport.width / imageBounds.width, viewport.height / imageBounds.height) : .05;
      const scale = Math.max(minimum, Math.min(Math.max(8, minimum * 8), previous.view.scale * distance / previous.distance));
      apply({ scale, x: midpoint.x - (previous.origin.x - previous.view.x) * scale / previous.view.scale,
        y: midpoint.y - (previous.origin.y - previous.view.y) * scale / previous.view.scale });
      return;
    }
    if (previous.distance) return;
    const dx = point.x - previous.origin.x, dy = point.y - previous.origin.y;
    if (Math.hypot(dx, dy) > 5) previous.moved = true;
    if (previous.tileId && previous.moved) {
      const tile = page.tiles.find(item => item.id === previous.tileId);
      if (tile) setMovedTile({ id: tile.id, point: { x: tile.x + dx / previous.view.scale, y: tile.y + dy / previous.view.scale } });
    }
    else if (previous.placeId && previous.moved) setMovedPlace({ id: previous.placeId, point: world(point) });
    else if (previous.moved) apply({ ...previous.view, x: previous.view.x + dx, y: previous.view.y + dy });
  }
  function up(event: PointerEvent<SVGSVGElement>) {
    const previous = gesture.current;
    const point = local(event);
    pointers.current.delete(event.pointerId);
    if (previous?.tileId && previous.moved) {
      const tile = page.tiles.find(item => item.id === previous.tileId);
      if (tile) onTileMove?.(tile.id, { x: tile.x + (point.x - previous.origin.x) / previous.view.scale, y: tile.y + (point.y - previous.origin.y) / previous.view.scale });
      setMovedTile(undefined);
    }
    else if (previous?.placeId && previous.moved && movedPlace) { onMove(movedPlace.id, movedPlace.point); setMovedPlace(undefined); }
    else if (previous && !previous.moved && !previous.distance) {
      if (tileEditing && previous.targetTileId) { onTile?.(previous.targetTileId); gesture.current = undefined; return; }
      const target = world(point);
      const place = page.places.find(item => item.id === previous.targetId)
        ?? page.places.find(item => Math.hypot(item.x - target.x, item.y - target.y) * viewRef.current.scale < 30);
      if (place) onPlace(place.id); else onPoint(target);
    }
    if (!pointers.current.size) gesture.current = undefined;
  }
  const bubbleSize = 25 / view.scale;
  function avatar(point: MapPoint, source: string | undefined | null, name: string, key: string, offset = 0) {
    const radius = bubbleSize * .65;
    const x = point.x + offset * radius * 1.65, y = point.y - radius * 2;
    return <g key={key}>
      <path d={`M ${x - radius / 3} ${y + radius * .7} L ${point.x} ${point.y - 4 / view.scale} L ${x + radius / 3} ${y + radius * .7}`} fill="white" />
      <circle cx={x} cy={y} r={radius} fill="white" stroke="#d4ddd5" strokeWidth={1 / view.scale} />
      {source ? <image href={source} x={x - radius * .87} y={y - radius * .87} width={radius * 1.74} height={radius * 1.74}
        preserveAspectRatio="xMidYMid slice" clipPath={`circle(${radius * .87}px at ${x}px ${y}px)`} /> :
        <text x={x} y={y + radius * .3} fontSize={radius} textAnchor="middle" fill="#455848">{name.slice(0, 1)}</text>}
    </g>;
  }
  const occupants = new Map<string, Character[]>();
  for (const activity of snapshot?.entries ?? []) {
    const place = placeOnMapPage(atlas, activity.placeId, page.id);
    const character = characters.find(item => item.id === activity.characterId);
    if (place && character) occupants.set(place.id, [...(occupants.get(place.id) ?? []), character]);
  }
  const userPlace = userPlaceId ? placeOnMapPage(atlas, userPlaceId, page.id) : undefined;
  return <div className="fmap-canvas" ref={frame} data-view-mode={cover ? "cover" : "fit"}>
    {!!page.tiles.length && <svg className="fmap-backdrop" aria-hidden="true" viewBox={`${imageBounds.x} ${imageBounds.y} ${imageBounds.width} ${imageBounds.height}`} preserveAspectRatio="xMidYMid slice">
      {[...page.tiles].reverse().map(tile => images[tile.mediaId] && <image key={tile.id} href={images[tile.mediaId]} x={tile.x} y={tile.y} width={tile.width} height={tile.height} preserveAspectRatio="none" />)}
    </svg>}
    <svg className="fmap-svg" role="application" aria-label="可拖动缩放的地图" onPointerDown={down} onPointerMove={move} onPointerUp={up}
      onPointerCancel={event => { pointers.current.delete(event.pointerId); gesture.current = undefined; setMovedPlace(undefined); setMovedTile(undefined); }}
      onWheel={event => zoom(event.deltaY < 0 ? 1.12 : .89, local(event))}>
      <g transform={`translate(${view.x},${view.y}) scale(${view.scale})`}>

        {[...visibleTiles].reverse().map((tile, index) => <g key={tile.id} data-tile={tile.id}
          role={tileEditing ? "button" : undefined} tabIndex={tileEditing ? 0 : undefined} aria-label={tileEditing ? `选择${tile.name || `图块${index + 1}`}` : undefined}
          onKeyDown={event => { if (tileEditing && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onTile?.(tile.id); } }}>
          {images[tile.mediaId] && <image href={images[tile.mediaId]} x={tile.x} y={tile.y} width={tile.width} height={tile.height} preserveAspectRatio="none" />}
          {tileEditing && <rect x={tile.x} y={tile.y} width={tile.width} height={tile.height} fill="transparent" stroke={selectedTileId === tile.id ? "#bd7044" : "#ffffffbb"} strokeWidth={(selectedTileId === tile.id ? 4 : 2) / view.scale} />}
        </g>)}
        {travel?.paths.map((path, index) => <polyline data-travel-path key={index} points={path.points.map(point => `${point.x},${point.y}`).join(" ")}
          fill="none" stroke="#3d7850" strokeWidth={4 / view.scale} strokeDasharray={travel.dashed ? `${8 / view.scale} ${6 / view.scale}` : undefined} />)}
        {!tileEditing && display.places.map(original => {
          const place = movedPlace?.id === original.id ? { ...original, ...movedPlace.point } : original;
          const members = occupants.get(place.id) ?? [];
          return <g key={place.id} data-place={place.id} role="button" tabIndex={0} aria-label={place.name}
            onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onPlace(place.id); } }}>
            <circle cx={place.x} cy={place.y} r={(selectedId === place.id ? 12 : 8) / view.scale} fill={selectedId === place.id ? "#5c785f" : "#fff"}
              stroke="#5c785f" strokeWidth={2 / view.scale} />
            <rect x={place.x - Math.max(26, place.name.length * 6) / view.scale} y={place.y + 13 / view.scale}
              width={Math.max(52, place.name.length * 12) / view.scale} height={25 / view.scale} rx={10 / view.scale} fill="#ffffffed" />
            <text x={place.x} y={place.y + 30 / view.scale} fontSize={12 / view.scale} fill="#26352b" textAnchor="middle">{place.name}{page.entryPlaceId === place.id ? " · 入口" : ""}</text>
            {!travel && members.length === 1 && avatar(place, members[0].avatar, members[0].name, members[0].id)}
            {!travel && members.length > 1 && <g transform={`translate(${place.x},${place.y - bubbleSize * 1.5})`}>
              <circle r={bubbleSize * .7} fill="white" /><text fontSize={14 / view.scale} fill="#405649" textAnchor="middle" dy=".35em">{members.length}人</text>
            </g>}
          </g>;
        })}
        {!travel && userPlace && avatar({ x: userPlace.x + 30 / view.scale, y: userPlace.y }, userAvatar, userName, "user")}
        {travel?.paths.map((path, index) => avatar(routePoint(path.points, path.progress), path.character ? path.character.avatar : userAvatar,
          path.character?.name ?? userName, `travel-${index}`, index))}
      </g>
    </svg>
    {!page.tiles.length && <div className="fmap-empty">添加地图图片，或生成这片区域的地图</div>}
    <div className="fmap-zoom"><button type="button" aria-label="放大地图" onClick={() => zoom(1.3)}>＋</button>
      <button type="button" aria-label="缩小地图" onClick={() => zoom(1 / 1.3)}>－</button>
      <button type="button" onClick={fit}>{cover ? "重置" : "全图"}</button>
      <button type="button" aria-pressed={cover} onClick={() => setCover(!cover)}>{cover ? "普通" : "铺满"}</button></div>
  </div>;
}
