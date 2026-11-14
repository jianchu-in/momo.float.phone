"use client";

import { useState, type FormEvent } from "react";
import { ChevronLeft } from "lucide-react";
import { resolveUserIdentity } from "@/lib/settings-storage";
import { loadCharacters } from "@/lib/character-storage";
import { loadPersonalNoteRemember, loadPersonalNoteTimerSettings, savePersonalNoteRemember, savePersonalNoteTimerSettings } from "@/lib/personal-note-timer-settings";

export function PersonalNoteTimerPanel({ onBack }: { onBack: () => void }) {
  const [settings, setSettings] = useState(loadPersonalNoteTimerSettings);
  const [remember, setRemember] = useState(loadPersonalNoteRemember);
  const [delayed, setDelayed] = useState(settings.delayMinutes > 0);
  const [characters] = useState(loadCharacters);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const identity = resolveUserIdentity();

  async function save(event: FormEvent) {
    event.preventDefault();
    if (settings.enabled && !characters.some(character => settings.characterIds.includes(character.id))) {
      setError("请至少选一个角色。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await savePersonalNoteRemember(remember);
      await savePersonalNoteTimerSettings({ ...settings, delayMinutes: delayed ? Math.max(1, settings.delayMinutes) : 0 });
      onBack();
    } catch {
      setError("设置保存失败，请重试。");
      setBusy(false);
    }
  }

  return <section className="diary-app">
    <header className="diary-app-header">
      <button type="button" className="diary-icon-btn" onClick={onBack} aria-label="返回手记"><ChevronLeft size={20} /></button>
      <h1>主动偷看设置</h1><span className="diary-header-spacer" />
    </header>
    <form className="diary-home personal-note-timer-panel" onSubmit={save}>
      <label><input type="checkbox" checked={settings.enabled} onChange={event => setSettings({ ...settings, enabled: event.target.checked })} /> 允许角色主动偷看</label>
      <p>同时适用于新写的「我的日记」和「备忘录」{identity?.name ? `（${identity.name}）` : ""}。角色会留下心声并主动发私聊。</p>
      <fieldset disabled={!settings.enabled || busy}>
        <legend>偷看时间</legend>
        <select value={delayed ? "delay" : "now"} onChange={event => setDelayed(event.target.value === "delay")}>
          <option value="now">保存后立即</option>
          <option value="delay">保存一段时间后</option>
        </select>
        {delayed && <label>延迟分钟 <input type="number" min={1} max={43200} required value={settings.delayMinutes || 1}
          onChange={event => setSettings({ ...settings, delayMinutes: event.target.valueAsNumber || 1 })} /></label>}
      </fieldset>
      <fieldset disabled={!settings.enabled || busy}>
        <legend>偷看的角色</legend>
        {!characters.length && <p>暂无角色</p>}
        <div className="personal-note-timer-characters">{characters.map(character => <label key={character.id}>
          <input type="checkbox" checked={settings.characterIds.includes(character.id)} onChange={event => setSettings({
            ...settings,
            characterIds: event.target.checked ? [...settings.characterIds, character.id] : settings.characterIds.filter(id => id !== character.id),
          })} /> {character.name}
        </label>)}</div>
      </fieldset>
      <label><input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} /> 记入角色的短期记忆</label>
      <p>网页关闭或被系统暂停时会延后，回到网页后检查到期任务。关闭偷看会取消尚未执行的任务。</p>
      {error && <p role="alert">{error}</p>}
      <button type="submit" className="note-reaction-home-link" disabled={busy}>保存设置</button>
    </form>
  </section>;
}
