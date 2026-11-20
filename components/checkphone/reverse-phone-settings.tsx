"use client";
import { useState } from "react";
import { loadCharacters } from "@/lib/character-storage";
import { getCharacterWorldGroup, loadCharacterWorldGroups } from "@/lib/character-world-storage";
import { inheritReverseOption, loadReverseSettings, resolveReversePermissions, updateReverseSettings } from "@/lib/reverse-phone-storage";
import { REVERSE_APPS, type AccessMode, type ReverseApp, type ReverseOverride, type ReverseScope, type ReverseSettings } from "@/lib/reverse-phone-types";

export function ReversePhoneSettings({ scope, initialCharacterId, initialApp, onClose }: { scope: ReverseScope; initialCharacterId?: string; initialApp?: ReverseApp; onClose: () => void }) {
  const [settings, setSettings] = useState(() => loadReverseSettings(scope));
  const [owner, setOwner] = useState("unified"), [app, setApp] = useState<ReverseApp>(initialApp ?? "chat");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const characters = loadCharacters(), worlds = loadCharacterWorldGroups();
  const [worldId, setWorldId] = useState(getCharacterWorldGroup(initialCharacterId ?? characters[0]?.id)?.id ?? "all");
  const override = settings.characters[owner] ?? {};
  const effective = owner === "unified" ? settings.unified : resolveReversePermissions(owner, scope);
  async function save(update: (value: ReverseSettings) => ReverseSettings) {
    setBusy(true); setError("");
    try { await updateReverseSettings(scope, update); setSettings(loadReverseSettings(scope)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "设置保存失败。"); }
    finally { setBusy(false); }
  }
  function option(section: keyof ReverseOverride, key: string, value: unknown) {
    void save(current => owner === "unified"
      ? { ...current, unified: { ...current.unified, [section]: { ...current.unified[section], [key]: value } } }
      : { ...current, characters: { ...current.characters, [owner]: inheritReverseOption(current.characters[owner] ?? {}, section, key, value) } });
  }
  function permission(section: "chat" | "shopping" | "browser", key: string, title: string) {
    const raw = (override[section] as Record<string, unknown> | undefined)?.[key];
    const enabled = (effective[section] as Record<string, unknown>)[key] === true;
    return <label className="rp-setting" key={key}><span>{title}</span>{owner === "unified"
      ? <input type="checkbox" checked={enabled} onChange={event => option(section, key, event.target.checked)} />
      : <select aria-label={title} value={raw === undefined ? "inherit" : String(raw)} onChange={event => option(section, key, event.target.value === "inherit" ? undefined : event.target.value === "true")}>
        <option value="inherit">跟随统一（{enabled ? "开启" : "关闭"}）</option><option value="true">开启</option><option value="false">关闭</option>
      </select>}</label>;
  }
  const defaultTargets = getCharacterWorldGroup(owner === "unified" ? initialCharacterId ?? characters[0]?.id : owner)?.memberIds ?? [];
  const targets = effective.chat.targets ?? defaultTargets;
  return <section className="rp-panel rp-settings" aria-label="反查岗设置">
    <header className="rp-header"><button onClick={onClose}>返回</button><h2>反查岗设置</h2></header>
    <main className="rp-scroll">
      <label>设置范围<select value={owner} onChange={event => setOwner(event.target.value)}><option value="unified">统一设置</option>
        {worlds.map(world => <optgroup key={world.id} label={world.name}>{characters.filter(character => world.memberIds.includes(character.id)).map(character => <option key={character.id} value={character.id}>{character.name} · 角色专属</option>)}</optgroup>)}
      </select></label>
      <p className="rp-muted">角色专属设置优先；未单独设置的项目跟随统一规则。</p>
      <nav className="rp-tabs">{(Object.keys(REVERSE_APPS) as ReverseApp[]).map(id => <button key={id} aria-pressed={app === id} onClick={() => setApp(id)}>{REVERSE_APPS[id]}</button>)}</nav>
      <fieldset disabled={busy}>
        {app === "chat" && <>
          <h3>允许查看的角色列表</h3>
          {owner !== "unified" && <label className="rp-setting"><span>跟随统一角色列表</span><input type="checkbox" checked={override.chat?.targets === undefined} onChange={event => option("chat", "targets", event.target.checked ? undefined : targets)} /></label>}
          <label>筛选角色<select value={worldId} onChange={event => setWorldId(event.target.value)}><option value="all">全部世界</option>{worlds.map(world => <option key={world.id} value={world.id}>{world.name}</option>)}</select></label>
          <button onClick={() => option("chat", "targets", null)}>使用同一世界的角色</button>
          <div className="rp-targets">{characters.filter(character => worldId === "all" || worlds.find(world => world.id === worldId)?.memberIds.includes(character.id)).map(character =>
            <label key={character.id}><input type="checkbox" checked={targets.includes(character.id)} onChange={event => option("chat", "targets", event.target.checked ? [...new Set([...targets, character.id])] : targets.filter(id => id !== character.id))} />{character.name}</label>)}</div>
          {permission("chat", "reply", "允许操作回复")}{permission("chat", "remark", "允许修改备注")}
          {permission("chat", "assets", "允许查看资产")}{permission("chat", "balance", "允许他修改我的资产余额")}
        </>}
        {app === "shopping" && <>{permission("shopping", "cart", "允许查看购物车")}{permission("shopping", "orders", "允许查看订单")}<p className="rp-muted">查看购物车时，角色可按人设用自己的资产替你买单。</p></>}
        {app === "browser" && <>{permission("browser", "history", "允许查看历史记录")}{permission("browser", "bookmarks", "允许查看收藏夹")}</>}
        {app === "reading" && <p>只查看书架上的书名，无细分权限。</p>}
        <hr />
        <label>应用总控制<select aria-label="应用总控制" value={owner !== "unified" && override.modes?.[app] === undefined ? "inherit" : effective.modes[app]}
          onChange={event => option("modes", app, event.target.value === "inherit" ? undefined : event.target.value as AccessMode)}>
          {owner !== "unified" && <option value="inherit">跟随统一</option>}<option value="open">允许查岗</option><option value="locked">隐私锁定 · 点开后告知角色</option><option value="hidden">系统限制 · 不生成该应用查岗</option>
        </select></label>
        <p className="rp-muted">隐私锁定会出现锁定页面并让角色回应；系统限制不提取内容、不安排点击，也不让模型得知该应用。</p>
        {owner !== "unified" && <button onClick={() => void save(current => { const entries = { ...current.characters }; delete entries[owner]; return { ...current, characters: entries }; })}>该角色全部恢复跟随统一</button>}
        <label className="rp-setting"><span>显示模拟触点</span><input type="checkbox" checked={settings.showTouch} onChange={event => void save(current => ({ ...current, showTouch: event.target.checked }))} /></label>
      </fieldset>
      {error && <p role="alert">{error}</p>}{busy && <p role="status">保存中…</p>}
    </main>
  </section>;
}
