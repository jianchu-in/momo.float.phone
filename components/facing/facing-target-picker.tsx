"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Plus, Trash2, UserRound, X } from "lucide-react";
import type { Character } from "@/lib/character-types";
import type { FacingGroup } from "@/lib/facing-storage";

function Avatar({ character }: { character?: Character }) {
  return <span className="facing-target-avatar" aria-hidden="true">{character?.avatar ? <img src={character.avatar} alt="" loading="lazy" decoding="async" /> : character?.name.slice(0, 1) || <UserRound size={23} />}</span>;
}

export function FacingTargetPicker({ characters, groups, participantIds, groupId, onSelect, onSave, onDelete, onClose }: {
  characters: Character[]; groups: FacingGroup[]; participantIds: string[]; groupId?: string;
  onSelect: (ids: string[], groupId?: string) => Promise<void>;
  onSave: (ids: string[]) => Promise<void>;
  onDelete: (groupId: string) => Promise<void>;
  onClose: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState(participantIds);
  const [deleting, setDeleting] = useState<FacingGroup>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    close.current?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, []);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError("");
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败，请重试。"); }
    finally { setBusy(false); }
  }
  const cancel = () => {
    if (busy) return;
    setError("");
    if (deleting) setDeleting(undefined);
    else if (creating) setCreating(false);
    else onClose();
  };
  const title = deleting ? "删除多人组" : creating ? "选择多人见面对象" : "选择见面对象";
  return <div className="facing-overlay facing-overlay-center facing-target-overlay" onClick={() => { if (!busy) onClose(); }}>
    <section className="facing-sheet facing-target-dialog" role="dialog" aria-modal="true" aria-label={title}
      onClick={event => event.stopPropagation()} onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); cancel(); }
        if (event.key !== "Tab") return;
        const nodes = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
        const first = nodes[0], last = nodes.at(-1);
        if (event.shiftKey && event.target === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && event.target === last) { event.preventDefault(); first?.focus(); }
      }}>
      <header><h2>{title}</h2><button ref={close} type="button" className="facing-icon" aria-label="关闭见面对象选择" disabled={busy} onClick={() => { if (!busy) onClose(); }}><X size={20} /></button></header>
      <div className="facing-target-body">
        {deleting ? <div className="facing-target-delete-copy"><p>删除“{deleting.name}”这个已保存的组合？</p><p>聊天记录和当前见面保留。以后重新选择相同角色，还能继续原记录。</p></div>
          : creating ? <><p className="facing-target-hint">选择两位或更多角色，直接保存即可。</p>
            <div className="facing-target-grid" role="group" aria-label="多人组成员">{characters.map(character => {
              const checked = selected.includes(character.id);
              return <button key={character.id} type="button" aria-pressed={checked} disabled={busy}
                onClick={() => setSelected(ids => ids.includes(character.id) ? ids.filter(id => id !== character.id) : [...ids, character.id])}>
                <Avatar character={character} /><span>{character.name}</span>{checked && <span className="facing-target-check" aria-hidden="true"><Check size={13} /></span>}
              </button>;
            })}</div></>
          : <>
            <section aria-label="单人见面"><h3>单人</h3><div className="facing-target-grid">{characters.map(character => <button key={character.id} type="button" disabled={busy}
              aria-pressed={participantIds.length === 1 && participantIds[0] === character.id}
              onClick={() => void run(() => onSelect([character.id]))}><Avatar character={character} /><span>{character.name}</span></button>)}</div></section>
            <section aria-label="已保存的多人组"><div className="facing-target-section-head"><h3>多人组</h3><button type="button" className="facing-small" disabled={busy || characters.length < 2} onClick={() => { setSelected(participantIds); setCreating(true); setError(""); }}><Plus size={15} />新建多人组</button></div>
              <div className="facing-target-groups">{groups.map(group => {
                const members = group.participantIds.map(id => characters.find(character => character.id === id)).filter((item): item is Character => !!item);
                const names = members.map(item => item.name).join("、");
                const name = group.name.trim() || names || "多人见面";
                return <div key={group.id} className="facing-target-group" data-active={groupId === group.id || undefined}>
                  <button type="button" className="facing-target-group-select" disabled={busy || members.length < 2} aria-pressed={groupId === group.id} onClick={() => void run(() => onSelect(members.map(item => item.id), group.id))}>
                    <span className="facing-target-collage" aria-hidden="true">{members.slice(0, 4).map(character => <Avatar key={character.id} character={character} />)}</span>
                    <span className="facing-target-group-copy"><strong>{name}</strong><small>{members.length} 人{names !== name ? ` · ${names}` : ""}{members.length < 2 ? " · 成员不足，请重新选择" : ""}</small></span>
                  </button>
                  <button type="button" className="facing-target-group-delete" aria-label={`删除多人组${name}`} disabled={busy} onClick={() => { setDeleting(group); setError(""); }}><Trash2 size={15} /><span>删除</span></button>
                </div>;
              })}</div>
              {!groups.length && <p className="facing-target-hint">还没有多人组。选择两个或更多角色，即可保存为组合。</p>}
            </section>
          </>}
      </div>
      {error && <p className="facing-error" role="alert">{error}</p>}
      {deleting ? <footer><button type="button" className="facing-soft" disabled={busy} onClick={cancel}>取消</button><button type="button" className="facing-target-confirm-delete" disabled={busy} onClick={() => void run(async () => { await onDelete(deleting.id); setDeleting(undefined); })}>{busy ? "正在删除…" : "删除多人组"}</button></footer>
        : creating ? <footer><button type="button" className="facing-soft" disabled={busy} onClick={cancel}>返回</button><button type="button" className="facing-primary" disabled={busy || selected.length < 2} onClick={() => void run(() => onSave(selected))}>{busy ? "正在保存…" : `保存并选择（${selected.length}人）`}</button></footer> : null}
    </section>
  </div>;
}
