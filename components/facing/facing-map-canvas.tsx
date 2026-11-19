"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { Character } from "@/lib/character-types";
import { getThemeAssetMap } from "@/lib/theme-storage";
import { mapBounds, placeOnMapPage, routePoint, type FacingAtlas, type FacingMapPage, type MapPoint, type MapSnapshot } from "@/lib/facing-map-storage";

export function FacingMapCanvas({ atlas, page, characters, snapshot, selectedId, editing, road, travel, userPlaceId, userAvatar, userName,
  onPlace, onPoint, onMove, onRoadMove }: {
  atlas: FacingAtlas; page: FacingMapPage; characters: Character[]; snapshot?: MapSnapshot; selectedId?: string;
  editing: boolean; road?: MapPoint[];
  travel?: { paths: { character?: Character; points: MapPoint[] }[]; progress: number; dashed: boolean };
  userPlaceId?: string; userAvatar?: string; userName: string;
  onPlace: (id: string) => void; onPoint: (point: MapPoint) => void; onMove: (id: string, point: MapPoint) => void;
  onRoadMove?: (index: number, point: MapPoint) => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [images, setImages] = useState<Record<string, string>>({});
  const [view, setView] = useState({ x: 0, y: 0, scale: .4 });
  const viewRef = useRef(view);
  const [movedPlace, setMovedPlace] = useState<{ id: string; point: MapPoint }>();
  const pointers = useRef(new Map<number, MapPoint>());
  const gesture = useRef<{ origin: MapPoint; view: typeof view; distance?: number; placeId?: string; roadIndex?: number; targetId?: string; moved: boolean } | undefined>(undefined);
  const bounds = mapBounds(page);
  const ids = page.tiles.map(tile => tile.mediaId).join("|");
  const margin = 100 / view.scale;
  const visibleTiles = page.tiles.filter(tile => tile.x + tile.width >= -view.x / view.scale - margin
    && tile.x <= ((frame.current?.clientWidth ?? 390) - view.x) / view.scale + margin
    && tile.y + tile.height >= -view.y / view.scale - margin
    && tile.y <= ((frame.current?.clientHeight ?? 600) - view.y) / view.scale + margin);
  const visibleIds = visibleTiles.map(tile => tile.mediaId).join("|");
  useEffect(() => {
    let active = true;
    void getThemeAssetMap(visibleTiles.map(tile => tile.mediaId)).then(result => { if (active) setImages(result); });
    return () => { active = false; };
  }, [visibleIds]);

  function apply(next: typeof view) { viewRef.current = next; setView(next); }
  function fit() {
    const rect = frame.current?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return;
    const scale = Math.min(rect.width / bounds.width, rect.height / bounds.height) * .9;
    apply({ scale, x: (rect.width - bounds.width * scale) / 2 - bounds.x * scale,
      y: (rect.height - bounds.height * scale) / 2 - bounds.y * scale });
  }
  useEffect(() => {
    fit();
    const observer = new ResizeObserver(() => fit());
    if (frame.current) observer.observe(frame.current);
    return () => observer.disconnect();
  }, [page.id, ids]);
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
    const scale = Math.max(.05, Math.min(8, current.scale * factor));
    const ratio = scale / current.scale;
    apply({ scale, x: at.x - (at.x - current.x) * ratio, y: at.y - (at.y - current.y) * ratio });
  }
  function down(event: PointerEvent<SVGSVGElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = local(event);
    pointers.current.set(event.pointerId, point);
    const placeId = (event.target as Element).closest("[data-place]")?.getAttribute("data-place") ?? undefined;
    const roadPoint = (event.target as Element).closest("[data-road-point]")?.getAttribute("data-road-point");
    const values = [...pointers.current.values()];
    gesture.current = { origin: point, view: viewRef.current, moved: false, targetId: placeId, placeId: editing && !road ? placeId : undefined,
      roadIndex: roadPoint === null || roadPoint === undefined ? undefined : Number(roadPoint) };
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
      const scale = Math.max(.05, Math.min(8, previous.view.scale * distance / previous.distance));
      apply({ scale, x: midpoint.x - (previous.origin.x - previous.view.x) * scale / previous.view.scale,
        y: midpoint.y - (previous.origin.y - previous.view.y) * scale / previous.view.scale });
      return;
    }
    if (previous.distance) return;
    const dx = point.x - previous.origin.x, dy = point.y - previous.origin.y;
    if (Math.hypot(dx, dy) > 5) previous.moved = true;
    if (previous.roadIndex !== undefined) onRoadMove?.(previous.roadIndex, world(point));
    else if (previous.placeId) setMovedPlace({ id: previous.placeId, point: world(point) });
    else if (previous.moved) apply({ ...previous.view, x: previous.view.x + dx, y: previous.view.y + dy });
  }
  function up(event: PointerEvent<SVGSVGElement>) {
    const previous = gesture.current;
    const point = local(event);
    pointers.current.delete(event.pointerId);
    if (previous?.placeId && previous.moved && movedPlace) { onMove(movedPlace.id, movedPlace.point); setMovedPlace(undefined); }
    else if (previous && !previous.moved && !previous.distance && previous.roadIndex === undefined) {
      const target = world(point);
      const place = page.places.find(item => item.id === previous.targetId)
        ?? page.places.find(item => Math.hypot(item.x - target.x, item.y - target.y) * viewRef.current.scale < 30);
      if (place) onPlace(place.id); else onPoint(target);
    }
    gesture.current = undefined;
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
  return <div className="fmap-canvas" ref={frame}>
    <svg className="fmap-svg" role="application" aria-label="可拖动缩放的地图" onPointerDown={down} onPointerMove={move} onPointerUp={up}
      onPointerCancel={event => { pointers.current.delete(event.pointerId); gesture.current = undefined; setMovedPlace(undefined); }}
      onWheel={event => zoom(event.deltaY < 0 ? 1.12 : .89, local(event))}>
      <g transform={`translate(${view.x},${view.y}) scale(${view.scale})`}>
        <rect x={bounds.x} y={bounds.y} width={bounds.width} height={bounds.height} rx={12} fill="#edf0e8" />
        {[...visibleTiles].reverse().map(tile => images[tile.mediaId] && <image key={tile.id} href={images[tile.mediaId]}
          x={tile.x} y={tile.y} width={tile.width} height={tile.height} preserveAspectRatio="none" />)}
        {page.roads.map(item => {
          const from = page.places.find(place => place.id === item.from), to = page.places.find(place => place.id === item.to);
          return from && to && <polyline key={item.id} points={[from, ...item.points, to].map(point => `${point.x},${point.y}`).join(" ")}
            stroke="#52695799" strokeWidth={3 / view.scale} fill="none" strokeLinecap="round" />;
        })}
        {road && <polyline points={road.map(point => `${point.x},${point.y}`).join(" ")} stroke="#ba7952" strokeWidth={3 / view.scale}
          strokeDasharray={`6 ${6 / view.scale}`} fill="none" />}
        {road?.slice(1).map((point, index) => <circle key={index} data-road-point={index} cx={point.x} cy={point.y}
          r={7 / view.scale} fill="white" stroke="#ba7952" strokeWidth={2 / view.scale} />)}
        {travel?.paths.map((path, index) => <polyline key={index} points={path.points.map(point => `${point.x},${point.y}`).join(" ")}
          fill="none" stroke="#3d7850" strokeWidth={4 / view.scale} strokeDasharray={travel.dashed ? `${8 / view.scale} ${6 / view.scale}` : undefined} />)}
        {page.places.map(original => {
          const place = movedPlace?.id === original.id ? { ...original, ...movedPlace.point } : original;
          const members = occupants.get(place.id) ?? [];
          return <g key={place.id} data-place={place.id} role="button" tabIndex={0} aria-label={place.name}
            onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onPlace(place.id); } }}>
            <circle cx={place.x} cy={place.y} r={(selectedId === place.id ? 12 : 8) / view.scale} fill={selectedId === place.id ? "#5c785f" : "#fff"}
              stroke="#5c785f" strokeWidth={2 / view.scale} />
            <rect x={place.x - Math.max(26, place.name.length * 6) / view.scale} y={place.y + 13 / view.scale}
              width={Math.max(52, place.name.length * 12) / view.scale} height={25 / view.scale} rx={10 / view.scale} fill="#ffffffed" />
            <text x={place.x} y={place.y + 30 / view.scale} fontSize={12 / view.scale} fill="#26352b" textAnchor="middle">{place.name}</text>
            {!travel && members.length === 1 && avatar(place, members[0].avatar, members[0].name, members[0].id)}
            {!travel && members.length > 1 && <g transform={`translate(${place.x},${place.y - bubbleSize * 1.5})`}>
              <circle r={bubbleSize * .7} fill="white" /><text fontSize={14 / view.scale} fill="#405649" textAnchor="middle" dy=".35em">{members.length}人</text>
            </g>}
          </g>;
        })}
        {!travel && userPlace && avatar({ x: userPlace.x + 30 / view.scale, y: userPlace.y }, userAvatar, userName, "user")}
        {travel?.paths.map((path, index) => avatar(routePoint(path.points, travel.progress), path.character?.avatar ?? userAvatar,
          path.character?.name ?? userName, `travel-${index}`, index))}
      </g>
    </svg>
    {!page.tiles.length && <div className="fmap-empty">添加地图图片，或生成这片区域的地图</div>}
    <div className="fmap-zoom"><button type="button" aria-label="放大地图" onClick={() => zoom(1.3)}>＋</button>
      <button type="button" aria-label="缩小地图" onClick={() => zoom(1 / 1.3)}>－</button>
      <button type="button" onClick={fit}>全图</button></div>
  </div>;
}
