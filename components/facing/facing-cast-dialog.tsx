"use client";
import { useState } from "react";
import { loadCharacters } from "@/lib/character-storage";
import type { FacingMeeting } from "@/lib/facing-storage";
import { addFacingParticipants, facingParticipantIds } from "@/lib/facing-storage";

export function FacingCastDialog({ meeting, onClose, onAdded }: {
  meeting: FacingMeeting; onClose: () => void; onAdded: (saved: FacingMeeting) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const present = facingParticipantIds(meeting);
  const available = loadCharacters().filter(item => !present.includes(item.id));
  async function save() {
    if (saving || !selected.length) return;
    setSaving(true); setError("");
    try { onAdded(await addFacingParticipants(meeting.id, selected)); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "角色加入失败，请重试。"); }
    finally { setSaving(false); }
  }
  return <div className="facing-overlay facing-overlay-center" onClick={() => { if (!saving) onClose(); }}>
    <section className="facing-sheet" role="dialog" aria-modal="true" aria-label="增加角色" onClick={event => event.stopPropagation()}>
      <header><h2>增加角色</h2><button type="button" disabled={saving} onClick={onClose}>关闭</button></header>
      <p>新角色从此刻加入当前地点，继续这段对话。已有聊天、地点和个人素材保留。</p>
      <fieldset disabled={saving} className="facing-list"><legend>选择加入的角色 · 可多选</legend>
        {available.map(item => <label key={item.id}><input type="checkbox" checked={selected.includes(item.id)} onChange={event => setSelected(ids => event.target.checked ? [...ids, item.id] : ids.filter(id => id !== item.id))} />{item.name}</label>)}
      </fieldset>
      {!available.length && <p>角色库中的角色都已在场。</p>}
      <button type="button" className="facing-primary" disabled={saving || !selected.length} onClick={() => void save()}>{saving ? "正在加入…" : `加入当前对话 · ${selected.length}人`}</button>
      {error && <p role="alert">{error}</p>}
    </section>
  </div>;
}
