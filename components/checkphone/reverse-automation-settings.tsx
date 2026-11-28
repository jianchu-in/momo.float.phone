"use client";
import { DEFAULT_REVERSE_AUTOMATION, normalizeReverseAutomation } from "@/lib/reverse-phone-automation";
import type { ReverseAutomation } from "@/lib/reverse-phone-types";

export function ReverseAutomationSettings({ value, unified, character, disabled, onChange, onReset }: {
  value?: Partial<ReverseAutomation>; unified?: ReverseAutomation; character:boolean; disabled:boolean;
  onChange:(key:keyof ReverseAutomation,value:unknown)=>void; onReset?:()=>void;
}) {
  const effective=normalizeReverseAutomation({...DEFAULT_REVERSE_AUTOMATION,...unified,...value});
  function toggle(key:"invitation"|"proactive"|"stealth",title:string) {
    return <label className="rp-setting"><span>{title}</span>{character?<select aria-label={title} value={value?.[key]===undefined?"inherit":String(value[key])} onChange={e=>onChange(key,e.target.value==="inherit"?undefined:e.target.value==="true")}><option value="inherit">跟随统一（{effective[key]?"开启":"关闭"}）</option><option value="true">开启</option><option value="false">关闭</option></select>:<input aria-label={title} type="checkbox" checked={effective[key]} onChange={e=>onChange(key,e.target.checked)}/>}</label>;
  }
  return <details className="rp-card" open><summary>触发与自主查岗</summary><fieldset disabled={disabled}>
    {toggle("invitation","聊天邀请后自动进入")}{toggle("proactive","允许角色在聊天中主动提出")}{toggle("stealth","允许自主偷偷查岗")}
    <p className="rp-muted">对话邀请由角色按人设接受或拒绝，接受后进入实时查岗。自主查岗完成后留下可回放记录，不打断当前页面。</p>
    <label>时间安排<select aria-label="查岗时间安排" value={effective.timing} onChange={e=>onChange("timing",e.target.value)}><option value="random">随机时间</option><option value="fixed">固定间隔</option></select></label>
    {effective.timing==="fixed"&&<label>固定间隔（小时）<input aria-label="固定间隔小时" type="number" min={1} max={720} value={effective.intervalHours} onChange={e=>onChange("intervalHours",Number(e.target.value))}/></label>}
    <label>两次至少间隔（小时）<input aria-label="查岗最短间隔" type="number" min={1} max={168} value={effective.minGapHours} onChange={e=>onChange("minGapHours",Number(e.target.value))}/></label>
    <label>每个角色连续七天最多自主查岗几次<input aria-label="七天查岗上限" type="number" min={1} max={30} value={effective.weeklyLimit} onChange={e=>onChange("weeklyLimit",Number(e.target.value))}/></label>
    {(["startsAt","endsAt"] as const).map(key=><label key={key}>{key==="startsAt"?"授权开始（留空立即）":"授权结束（留空长期）"}<input aria-label={key==="startsAt"?"授权开始":"授权结束"} type="datetime-local" value={effective[key] ? new Date(Date.parse(effective[key])-new Date(effective[key]).getTimezoneOffset()*60000).toISOString().slice(0,16) : ""} onChange={e=>onChange(key,e.target.value?new Date(e.target.value).toISOString():"")}/></label>)}
    {character&&<button onClick={onReset}>触发与时间恢复跟随统一</button>}
    <p className="rp-muted">每个角色分别计次，同一用户身份和聊天账号下滚动七天计算；统一设置只统一规则，不共用次数。七天次数只限制自主查岗，手动和对话邀请不占次数。随机时间会保存，刷新不重抽；次数是上限，不保证查满。应用运行或后台保活期间执行，关闭网页或系统清理后无法保证；重开不集中补查。查看与真实操作均遵守下方应用权限。</p>
  </fieldset></details>;
}
