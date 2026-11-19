"use client";

import { useEffect, useRef, useState } from "react";
import type { Character } from "@/lib/character-types";
import { type MapPoint, type MapTrip } from "@/lib/facing-map-storage";

export type MapTravelAnimation = {
  trip: MapTrip;
  mode: "route" | "car";
  paths: { character?: Character; points: MapPoint[] }[];
};
export function MapTravel({ animation, duration, destination, characters, userAvatar, userName, onProgress, onArrive, onCancel }: {
  animation: MapTravelAnimation; duration: number; destination: string; characters: Character[]; userAvatar?: string; userName: string;
  onProgress: (value: number) => void; onArrive: () => Promise<void>; onCancel: () => void;
}) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const finishing = useRef(false);
  const callbacks = useRef({ onProgress, onArrive });
  callbacks.current = { onProgress, onArrive };
  async function arrive() {
    if (finishing.current) return;
    finishing.current = true;
    setSaving(true); setError("");
    try { await callbacks.current.onArrive(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "到达记录保存失败。"); finishing.current = false; setSaving(false); }
  }
  useEffect(() => {
    const start = performance.now() + 700;
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.max(0, Math.min(1, (now - start) / (Math.max(1, duration) * 1000)));
      callbacks.current.onProgress(progress);
      if (progress >= 1) { setReady(true); void arrive(); }
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animation, duration]);
  const members = animation.trip.characterIds.map(id => characters.find(character => character.id === id)).filter((item): item is Character => !!item);
  return <div className={`fmap-travel fmap-travel-${animation.mode}`} role="status" aria-label="正在前往目的地">
    {animation.mode === "car" && <div className="fmap-travel-party">
      <span className="fmap-travel-avatar">{userAvatar ? <img src={userAvatar} alt={userName} /> : userName.slice(0, 1)}</span>
      {members.map(character => <span key={character.id} className="fmap-travel-avatar">{character.avatar ? <img src={character.avatar} alt={character.name} /> : character.name.slice(0, 1)}</span>)}
      <span className="fmap-car" aria-hidden>🚗💨💨</span>
    </div>}
    <p>{saving ? "正在进入面对面…" : `正在前往${destination}…`}</p>
    {error && <p role="alert">{error}</p>}
    <div className="facing-choices">
      {!saving && <button type="button" className="facing-small" onClick={() => { setReady(true); callbacks.current.onProgress(1); void arrive(); }}>{error ? "重试进入" : ready ? "进入面对面" : "跳过动画"}</button>}
      {!saving && <button type="button" className="facing-small" onClick={onCancel}>取消前往</button>}
    </div>
  </div>;
}
