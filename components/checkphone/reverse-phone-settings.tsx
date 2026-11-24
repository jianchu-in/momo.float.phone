"use client";
import { ReverseAutomationSettings } from "./reverse-automation-settings";
import { Component, useEffect, useState, type ReactNode } from "react";
import { loadCharacters } from "@/lib/character-storage";
import { getCharacterWorldGroup, loadCharacterWorldGroups } from "@/lib/character-world-storage";
import { inheritReverseOption, loadReverseSettings, resolveReversePermissions, updateReverseSettings } from "@/lib/reverse-phone-storage";
import { REVERSE_APPS, type AccessMode, type ReverseApp, type ReverseOverride, type ReverseScope, type ReverseSettings } from "@/lib/reverse-phone-types";

type ReverseSettingsProps = { scope: ReverseScope; onHistory?:()=>void; initialOwner?: string; initialCharacterId?: string; initialApp?: ReverseApp; onClose: () => void };
class ReverseSettingsBoundary extends Component<{onClose:()=>void; children:ReactNode}, {error:string}> {
  state = {error:""};
  static getDerivedStateFromError(error: unknown) { return {error:error instanceof Error ? error.message : String(error)}; }
  componentDidCatch(error: unknown) { console.warn("反查岗设置显示失败，已有设置保留", error); }
  render() {
    if (!this.state.error) return this.props.children;
    return <section className="rp-panel"><header className="rp-header"><button onClick={this.props.onClose}>返回</button><h2>反查岗设置</h2></header><main className="rp-scroll"><p role="alert">设置暂时无法显示，已有设置和查岗记录均保留。</p><button onClick={()=>this.setState({error:""})}>重试打开设置</button><button onClick={this.props.onClose}>返回我的手机</button></main></section>;
  }
}
export function ReversePhoneSettings(props: ReverseSettingsProps) {
  return <ReverseSettingsBoundary key={props.scope.key} onClose={props.onClose}><ReverseSettingsContents {...props}/></ReverseSettingsBoundary>;
}
function ReverseSettingsContents({ scope, initialCharacterId, initialApp, initialOwner, onHistory, onClose }: ReverseSettingsProps) {
  const [settings, setSettings] = useState(() => loadReverseSettings(scope));
  const [owner, setOwner] = useState(initialOwner ?? "unified"), [app, setApp] = useState<ReverseApp>(initialApp ?? "chat");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const characters = loadCharacters(), worlds = loadCharacterWorldGroups();
  const [worldId, setWorldId] = useState(getCharacterWorldGroup(initialCharacterId ?? characters[0]?.id)?.id ?? "all");
  const [search, setSearch] = useState(""), [targetLimit, setTargetLimit] = useState(80);
  useEffect(() => {setTargetLimit(80);}, [owner, worldId, search]);
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
      ? section === "automation" ? { ...current, automation: { ...current.automation, [key]: value } as import("@/lib/reverse-phone-types").ReverseAutomation } : { ...current, unified: { ...current.unified, [section]: { ...current.unified[section], [key]: value } } }
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
  const viewingCharacterId = owner === "unified" ? initialCharacterId ?? characters[0]?.id : owner;
  const viewingCharacter = characters.find(character => character.id === viewingCharacterId);
  const viewingWorld = viewingCharacterId ? getCharacterWorldGroup(viewingCharacterId) : null;
  const viewingName = viewingCharacter?.name ?? "未选择角色";
  const defaultTargets = viewingWorld?.memberIds ?? [];
  const targets = effective.chat.targets ?? defaultTargets;
  const filteredTargets = characters.filter(character => (worldId === "all" || worlds.find(world => world.id === worldId)?.memberIds.includes(character.id)) && character.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <section className="rp-panel rp-settings" aria-label="反查岗设置">
    <header className="rp-header"><button onClick={onClose}>返回</button><h2>反查岗设置</h2></header>
    <main className="rp-scroll">
      {onHistory&&<button className="rp-card" onClick={onHistory}>查看查岗记录与回放</button>}
      <label>设置范围<select aria-label="反查岗设置范围" value={owner} onChange={event => setOwner(event.target.value)}><option value="unified">统一设置</option>
        {worlds.map(world => <optgroup key={world.id} label={world.name}>{characters.filter(character => world.memberIds.includes(character.id)).map(character => <option key={character.id} value={character.id}>{character.name} · 角色专属</option>)}</optgroup>)}
        <optgroup label="未分配世界">{characters.filter(character=>!worlds.some(world=>world.memberIds.includes(character.id))).map(character=><option key={character.id} value={character.id}>{character.name} · 角色专属</option>)}</optgroup>
      </select></label>
      <p className="rp-muted">{owner === "unified" ? "当前修改统一规则：下方查看名单、操作权限和应用锁，对所有跟随统一设置的角色生效。" : `当前只为「${viewingName}」设置查看名单、操作权限和应用锁；未单独设置的项目跟随统一规则。`}</p>
      <ReverseAutomationSettings key={owner} character={owner!=="unified"} value={owner==="unified"?settings.automation:override.automation} unified={settings.automation} disabled={busy} onReset={()=>void save(current=>({...current,characters:{...current.characters,[owner]:{...current.characters[owner],automation:undefined}}}))} onChange={(key,value)=>{ if(owner==="unified")void save(current=>({...current,automation:{...current.automation,[key]:value} as import("@/lib/reverse-phone-types").ReverseAutomation}));else option("automation",key,value); }} />
      <nav className="rp-tabs">{(Object.keys(REVERSE_APPS) as ReverseApp[]).map(id => <button key={id} aria-pressed={app === id} onClick={() => setApp(id)}>{REVERSE_APPS[id]}</button>)}</nav>
      <fieldset disabled={busy}>
        {app === "chat" && <>
          <h3>允许查看的角色列表</h3>
          <p className="rp-muted">{owner === "unified"
            ? "勾选某个角色，表示允许查岗者查看你与这个角色的聊天。统一自定义名单由所有跟随者共用；使用同一世界时，各查岗角色自动使用自己的世界，下面仅预览当前角色。"
            : `勾选下方角色，表示允许「${viewingName}」查看你与这些角色的聊天记录；未勾选的会话不可查看。这里不是选择谁来查岗。`}</p>
          {owner !== "unified" && <label className="rp-setting"><span>跟随统一角色列表</span><input type="checkbox" checked={override.chat?.targets === undefined} onChange={event => option("chat", "targets", event.target.checked ? undefined : targets)} /></label>}
          <label>按世界筛选名单<select aria-label="筛选显示的世界" value={worldId} onChange={event => setWorldId(event.target.value)}><option value="all">全部世界</option>{worlds.map(world => <option key={world.id} value={world.id}>{world.name}</option>)}</select></label>
          <p className="rp-muted">筛选只改变名单显示，不会自动勾选或取消角色。</p>
          <div className="rp-target-context"><button onClick={() => option("chat", "targets", null)}>使用同一世界的角色</button><span role="note" aria-live="polite">{owner === "unified" ? "当前预览角色" : "当前查岗角色"}：{viewingName} · {viewingWorld?.name ?? "未分配世界"}</span></div>
          <label>搜索名单<input aria-label="搜索可查看的角色" value={search} onChange={event=>setSearch(event.target.value)} placeholder="输入角色名称" /></label>
          <div className="rp-targets">{filteredTargets.slice(0,targetLimit).map(character =>
            <label key={character.id}><input type="checkbox" checked={targets.includes(character.id)} onChange={event => option("chat", "targets", event.target.checked ? [...new Set([...targets, character.id])] : targets.filter(id => id !== character.id))} />{character.name}</label>)}</div>
          {filteredTargets.length>targetLimit&&<button type="button" onClick={()=>setTargetLimit(value=>value+80)}>显示更多角色（已显示{targetLimit}/{filteredTargets.length}）</button>}
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
