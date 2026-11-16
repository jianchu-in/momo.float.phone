"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { UserRound } from "lucide-react";
import type { FacingAsset, FacingHotspot } from "@/lib/facing-storage";
import { getThemeAssetDataUrl } from "@/lib/theme-storage";

export function useFacingMediaUrl(asset?: FacingAsset) {
  const [media, setMedia] = useState<{ id: string; url: string | null }>();
  const id = asset?.mediaId;
  useEffect(() => {
    let current = true;
    if (id) void getThemeAssetDataUrl(id).then(url => {
      if (current) setMedia({ id, url });
    }).catch(() => {
      if (current) setMedia({ id, url: null });
    });
    return () => { current = false; };
  }, [id]);
  return media?.id === id ? media?.url : null;
}

export function FacingMedia({ url, mediaType, name, loop = true, onEnd, onRatio }: {
  url: string;
  mediaType: string;
  name: string;
  loop?: boolean;
  onEnd?: () => void;
  onRatio?: (ratio: number) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const node = video.current;
    if (!node) return;
    node.play().catch(() => {});
    return () => { node.pause(); };
  }, [url]);

  if (mediaType.startsWith("video/")) {
    return <video ref={video} src={url} autoPlay muted loop={loop} playsInline preload="metadata" aria-label={name}
      onEnded={onEnd} onLoadedMetadata={event => {
        const { videoWidth, videoHeight } = event.currentTarget;
        if (videoHeight > 0) onRatio?.(videoWidth / videoHeight);
      }} />;
  }
  return <img src={url} alt={name} draggable={false} onLoad={event => {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    if (naturalHeight > 0) onRatio?.(naturalWidth / naturalHeight);
  }} />;
}

export function FacingStage({ portrait, scene, reaction, fallback, name, points = [], editing, activePoint, onPoint,
  onPointMove, onReactionEnd, children }: {
  portrait?: FacingAsset;
  scene?: FacingAsset;
  reaction?: FacingAsset;
  fallback?: string | null;
  name: string;
  points?: FacingHotspot[];
  editing?: boolean;
  activePoint?: string;
  onPoint?: (point: FacingHotspot) => void;
  onPointMove?: (id: string, x: number, y: number) => void;
  onReactionEnd?: () => void;
  children?: ReactNode;
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [ratio, setRatio] = useState<{ key: string; value: number }>();
  const area = useRef<HTMLDivElement>(null);
  const figure = useRef<HTMLDivElement>(null);
  const portraitUrl = useFacingMediaUrl(portrait);
  const reactionUrl = useFacingMediaUrl(reaction);
  const sceneUrl = useFacingMediaUrl(scene);
  const foreground = reactionUrl ? reaction : portrait;
  const mediaUrl = reactionUrl || portraitUrl;
  const mediaKey = foreground?.mediaId ?? fallback ?? "";
  const ratioValue = ratio?.key === mediaKey ? ratio.value : 0.72;
  const layout = foreground?.layout ?? portrait?.layout;
  const full = foreground?.composition === "full" && Boolean(mediaUrl);
  const fitWidth = full ? Math.max(size.width, size.height * ratioValue) : Math.min(size.width, size.height * ratioValue);
  const width = fitWidth * (layout?.scale ?? 100) / 100;
  const height = width / ratioValue;
  const hasMedia = Boolean(mediaUrl || fallback);

  useEffect(() => {
    const element = area.current;
    if (!element) return;
    function measure() {
      if (element) setSize({ width: element.clientWidth, height: element.clientHeight });
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return <div className="facing-stage" ref={area}>
    {scene && sceneUrl && <div className="facing-scene" key={scene.mediaId} style={{ "--facing-scene-x": `${scene.layout?.x ?? 50}%`,
      "--facing-scene-y": `${scene.layout?.y ?? 50}%`, "--facing-scene-scale": (scene.layout?.scale ?? 100) / 100 } as React.CSSProperties}>
      <FacingMedia url={sceneUrl} mediaType={scene.mediaType} name={scene.name} />
    </div>}
    <div ref={figure} className="facing-figure" style={full ? {
      width, height, transform: "none",
      left: (size.width - width) * (layout?.x ?? 50) / 100,
      top: (size.height - height) * (layout?.y ?? 50) / 100,
    } : {
      width: width || "78%", height: width ? height : "91%",
      left: `${layout?.x ?? 50}%`, top: `${layout?.y ?? 100}%`,
    }}>
      {mediaUrl && foreground
        ? <FacingMedia key={mediaKey} url={mediaUrl} mediaType={foreground.mediaType} name={foreground.name}
            onRatio={value => setRatio({ key: mediaKey, value })} loop={!reactionUrl} onEnd={onReactionEnd} />
        : fallback
          ? <FacingMedia key={mediaKey} url={fallback} mediaType="image/png" name={name} onRatio={value => setRatio({ key: mediaKey, value })} />
          : <div className="facing-blank-portrait"><UserRound size={64} strokeWidth={1} aria-hidden /></div>}
      {hasMedia && !reaction && points.map(point => <button type="button" key={point.id}
        aria-label={editing ? `调整${point.label}` : `触碰${point.label}`}
        className={editing ? "facing-point facing-point-edit" : "facing-point"}
        aria-pressed={editing ? activePoint === point.id : undefined}
        style={{ left: `${point.x}%`, top: `${point.y}%`, width: `${point.width}%`, height: `${point.height}%` }}
        onClick={() => onPoint?.(point)}
        onPointerDown={editing ? event => {
          onPoint?.(point);
          event.currentTarget.setPointerCapture(event.pointerId);
        } : undefined}
        onPointerMove={editing ? event => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const bounds = figure.current?.getBoundingClientRect();
          if (!bounds?.width || !bounds.height) return;
          onPointMove?.(point.id, Math.max(0, Math.min(100, (event.clientX - bounds.left) / bounds.width * 100)),
            Math.max(0, Math.min(100, (event.clientY - bounds.top) / bounds.height * 100)));
        } : undefined}>{editing ? point.label : null}</button>)}
    </div>
    {children}
  </div>;
}
