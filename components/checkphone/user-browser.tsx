"use client";
import { useEffect, useRef, useState } from "react";
import { loadCharacters } from "@/lib/character-storage";
import { generateUserBrowserEntries } from "@/lib/reverse-phone-engine";
import { loadUserBrowser, reverseId, saveUserBrowserEntry } from "@/lib/reverse-phone-storage";
import type { BrowserEntry, ReverseScope } from "@/lib/reverse-phone-types";

export function UserBrowser({ scope, initialCharacterId, onClose, onSettings }: { scope: ReverseScope; initialCharacterId?: string; onClose: () => void; onSettings: () => void }) {
  const [entries, setEntries] = useState(() => loadUserBrowser(scope));
  const [tab, setTab] = useState<BrowserEntry["kind"]>("history"), [draft, setDraft] = useState<BrowserEntry>();
  const [menu, setMenu] = useState(false), [ai, setAi] = useState(false), [requirement, setRequirement] = useState("");
  const [selectedCharacter, setSelectedCharacter] = useState(initialCharacterId ?? loadCharacters()[0]?.id ?? "");
  const [generated, setGenerated] = useState<Array<Pick<BrowserEntry, "title" | "url" | "description">>>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function write(entry: BrowserEntry, remove = false) {
    setBusy(true); setError("");
    try { await saveUserBrowserEntry(scope, entry, remove); setEntries(loadUserBrowser(scope)); setDraft(undefined); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败。"); }
    finally { setBusy(false); }
  }
  async function generate() {
    const character = loadCharacters().find(item => item.id === selectedCharacter);
    if (!character || !requirement.trim()) { setError("请选择API绑定角色并填写生成或润色要求。"); return; }
    setBusy(true); setError(""); const control = new AbortController(); controller.current = control;
    try { setGenerated(await generateUserBrowserEntries(character, scope, tab, requirement, draft ? [draft] : entries.filter(item => item.kind === tab), control.signal)); }
    catch (cause) { if (!control.signal.aborted) setError(cause instanceof Error ? cause.message : "生成失败。"); }
    finally { setBusy(false); controller.current = null; }
  }
  async function applyGenerated() {
    setBusy(true);
    try {
      for (const [index, item] of generated.entries()) await saveUserBrowserEntry(scope, { ...item, id: draft && index === 0 ? draft.id : reverseId(), kind: draft?.kind ?? tab, updatedAt: new Date().toISOString() });
      setEntries(loadUserBrowser(scope)); setGenerated([]); setAi(false); setDraft(undefined);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "应用失败。"); }
    finally { setBusy(false); }
  }
  return <section className="rp-panel" aria-label="我的浏览器">
    <header className="rp-header"><button onClick={() => { controller.current?.abort(); onClose(); }}>返回</button><h2>浏览器</h2><button onClick={() => setMenu(!menu)}>设置</button></header>
    <main className="rp-scroll">
      {menu && <div className="rp-actions"><button onClick={() => { setAi(true); setMenu(false); }}>AI辅助生成／润色</button><button onClick={onSettings}>查岗设置</button></div>}
      <nav className="rp-tabs"><button aria-pressed={tab === "history"} onClick={() => setTab("history")}>历史记录</button><button aria-pressed={tab === "bookmarks"} onClick={() => setTab("bookmarks")}>收藏夹</button></nav>
      <button onClick={() => setDraft({ id: reverseId(), kind: tab, title: "", url: "", description: "", updatedAt: "" })}>添加{tab === "history" ? "历史记录" : "收藏"}</button>
      {entries.filter(item => item.kind === tab).map(entry => <article key={entry.id} className="rp-card"><strong>{entry.title}</strong><small>{entry.url}</small><p>{entry.description}</p>
        <div className="rp-actions"><button disabled={busy} onClick={() => setDraft(entry)}>编辑</button><button disabled={busy} onClick={() => void write(entry, true)}>删除</button></div></article>)}
      {!entries.some(item => item.kind === tab) && <p className="rp-muted">暂无{tab === "history" ? "历史记录" : "收藏"}，可以手动添加或使用右上角AI辅助。</p>}
      {draft && <fieldset disabled={busy}><legend>编辑记录</legend><label>标题<input value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label><label>网址<input value={draft.url} onChange={event => setDraft({ ...draft, url: event.target.value })} /></label>
        <label>内容<textarea value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label><div className="rp-actions"><button onClick={() => setDraft(undefined)}>取消</button><button disabled={!draft.title.trim()} onClick={() => void write(draft)}>保存记录</button><button onClick={() => { setAi(true); setRequirement("润色这条记录，保留原意。"); }}>AI润色此记录</button></div></fieldset>}
      {ai && <fieldset disabled={busy}><legend>AI辅助生成／润色</legend><label>使用角色绑定的文字API<select value={selectedCharacter} onChange={event => setSelectedCharacter(event.target.value)}>{loadCharacters().map(character => <option key={character.id} value={character.id}>{character.name}</option>)}</select></label>
        <label>你的要求<textarea value={requirement} onChange={event => setRequirement(event.target.value)} placeholder="例如：生成最近搜索的周末旅行攻略。" /></label><button onClick={() => void generate()}>生成预览</button>
        {generated.map((item, index) => <article className="rp-card" key={index}><strong>{item.title}</strong><small>{item.url}</small><p>{item.description}</p></article>)}
        {!!generated.length && <button onClick={() => void applyGenerated()}>确认应用</button>}<button onClick={() => { setAi(false); setGenerated([]); }}>关闭</button></fieldset>}
      {busy && <div role="status">处理中…<button onClick={() => controller.current?.abort()}>停止生成</button></div>}{error && <p role="alert">{error}</p>}
    </main>
  </section>;
}
