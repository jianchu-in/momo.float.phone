"use client";

import { useId, useState, type FormEvent } from "react";
import { BookOpenText, ChevronDown, ChevronLeft, Eye, Users } from "lucide-react";
import { Avatar } from "@/components/ui/primitives";
import { loadCharacters } from "@/lib/character-storage";
import { resolveChatCharacterAvatar } from "@/lib/chat-storage";
import { loadPersonalNoteTimerSettings, savePersonalNoteTimerSettings } from "@/lib/personal-note-timer-settings";

const TIMES = [
  { value: 0, label: "立即" },
  { value: 15, label: "15 分钟" },
  { value: 30, label: "30 分钟" },
  { value: 60, label: "1 小时" },
  { value: 1440, label: "1 天" },
] as const;

const UNITS = [
  { value: 1, label: "分钟" },
  { value: 60, label: "小时" },
  { value: 1440, label: "天" },
] as const;

const MAX_MINUTES = 30 * 1440;

export function PersonalNoteTimerPanel({ onBack }: { onBack: () => void }) {
  const [settings, setSettings] = useState(loadPersonalNoteTimerSettings);
  const [custom, setCustom] = useState(() => !TIMES.some(time => time.value === settings.delayMinutes));
  const [unit, setUnit] = useState(() => [...UNITS].reverse().find(item =>
    settings.delayMinutes >= item.value && settings.delayMinutes % item.value === 0)?.value ?? 1);
  const [duration, setDuration] = useState(() => String((settings.delayMinutes || 15) / unit));
  const [characters] = useState(loadCharacters);
  const [charactersOpen, setCharactersOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const characterListId = useId();
  const selected = characters.filter(character => settings.characterIds.includes(character.id));

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const delayMinutes = custom ? Number(duration) * unit : settings.delayMinutes;
    if (settings.enabled && !selected.length) {
      setCharactersOpen(true);
      setError("请至少选一个偷看的角色。");
      return;
    }
    if (settings.enabled && custom && (!Number.isInteger(Number(duration)) || delayMinutes < 1 || delayMinutes > MAX_MINUTES)) {
      setError("请填写 1 分钟至 30 天内的等待时间。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await savePersonalNoteTimerSettings({ ...settings, delayMinutes: settings.enabled ? delayMinutes : settings.delayMinutes });
      onBack();
    } catch {
      setError("设置保存失败，请重试。");
      setBusy(false);
    }
  }

  return <section className="diary-app personal-note-timer">
    <header className="diary-app-header">
      <button type="button" className="diary-icon-btn" onClick={onBack} aria-label="返回手记"><ChevronLeft size={20} /></button>
      <div><h1>主动偷看设置</h1></div>
      <span className="diary-header-spacer" />
    </header>
    <form className="personal-note-timer-panel" onSubmit={save}>
      <div className="personal-note-timer-scroll">
        <section className="peek-settings-card peek-settings-intro">
          <label className="peek-settings-row">
            <span className="peek-settings-icon"><Eye size={19} strokeWidth={1.6} /></span>
            <span className="peek-settings-copy">
              <strong>允许角色主动偷看</strong>
              <small>适用于新保存的日记和备忘录</small>
            </span>
            <input className="peek-settings-switch" role="switch" type="checkbox" checked={settings.enabled}
              disabled={busy} onChange={event => setSettings({ ...settings, enabled: event.target.checked })} />
          </label>
        </section>
        <fieldset className="peek-settings-body" disabled={!settings.enabled || busy}>
          <div className="peek-settings-card">
            <div className="peek-settings-section">
              <h2>偷看时间</h2>
              <p>从手记保存时开始计时</p>
              <div className="peek-time-options" role="group" aria-label="保存后多久偷看">
                {TIMES.map(time => <button key={time.value} type="button"
                  aria-pressed={!custom && settings.delayMinutes === time.value}
                  onClick={() => {
                    setCustom(false);
                    setSettings({ ...settings, delayMinutes: time.value });
                  }}>{time.label}</button>)}
                <button type="button" aria-pressed={custom} onClick={() => setCustom(true)}>自定义</button>
              </div>
              {custom && <div className="peek-time-custom">
                <span>保存后等待</span>
                <input type="number" aria-label="等待时长" min={1} max={MAX_MINUTES / unit} required
                  value={duration} onChange={event => setDuration(event.target.value)} />
                <select aria-label="等待时间单位" value={unit}
                  onChange={event => setUnit(Number(event.target.value) as typeof unit)}>
                  {UNITS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </div>}
            </div>
            <div className="peek-settings-section">
              <label className="peek-settings-row">
                <span className="peek-settings-icon"><BookOpenText size={18} strokeWidth={1.6} /></span>
                <span className="peek-settings-copy">
                  <strong>将偷看心声计入短期记忆</strong>
                  <small>角色之后仍有机会记得这件事</small>
                </span>
                <input className="peek-settings-switch" role="switch" type="checkbox" checked={settings.remember}
                  onChange={event => setSettings({ ...settings, remember: event.target.checked })} />
              </label>
              {settings.remember && <fieldset className="peek-follow-up">
                <legend>计入短期记忆后</legend>
                <label><input type="radio" name="peek-follow-up" checked={!settings.sendMessage}
                  onChange={() => setSettings({ ...settings, sendMessage: false })} />只记住，不发私聊</label>
                <label><input type="radio" name="peek-follow-up" checked={settings.sendMessage}
                  onChange={() => setSettings({ ...settings, sendMessage: true })} />角色立即发私聊</label>
              </fieldset>}
            </div>
          </div>
          <div className="peek-settings-card">
            <button className="peek-settings-row peek-character-trigger" type="button" aria-expanded={charactersOpen}
              aria-controls={characterListId} onClick={() => setCharactersOpen(open => !open)}>
              <span className="peek-settings-icon"><Users size={18} strokeWidth={1.6} /></span>
              <span className="peek-settings-copy">
                <strong>偷看的角色</strong>
                <small>{selected.map(character => character.name).join("、") || "点击选择角色"}</small>
              </span>
              <ChevronDown className="peek-character-chevron" size={17} />
            </button>
            {charactersOpen && <div id={characterListId} className="peek-character-list">
              {!characters.length && <p>暂无可选角色</p>}
              {characters.map(character => <label key={character.id}>
                <Avatar src={resolveChatCharacterAvatar(character)} name={character.name} size="sm" />
                <span>{character.name}</span>
                <input type="checkbox" checked={settings.characterIds.includes(character.id)} onChange={event => setSettings({
                  ...settings, characterIds: event.target.checked ? [...settings.characterIds, character.id]
                    : settings.characterIds.filter(id => id !== character.id),
                })} />
              </label>)}
            </div>}
          </div>
        </fieldset>
        {settings.enabled && <p className="peek-settings-hint">网页关闭或暂停时，回到网页后再检查到期的手记。</p>}
      </div>
      <footer className="peek-settings-footer">
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={busy}>{busy ? "保存中…" : "保存设置"}</button>
      </footer>
    </form>
  </section>;
}
