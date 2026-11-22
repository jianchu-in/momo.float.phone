"use client";
import {facingId,type FacingReplyGroup} from "@/lib/facing-storage";
import type {Character} from "@/lib/character-types";
export function FacingGroupEditor({ids,characters,value,onChange}:{ids:string[];characters:Character[];value:FacingReplyGroup[];onChange:(groups:FacingReplyGroup[])=>void}){
 if(ids.length<2)return null;
 return <fieldset className="facing-form"><legend>回应分组</legend><label><input type="checkbox" checked={value.length>0} onChange={e=>onChange(e.target.checked?[{id:facingId(),name:"第1组",characterIds:ids.filter((_,i)=>i%2===0)},{id:facingId(),name:"第2组",characterIds:ids.filter((_,i)=>i%2===1)}]:[])}/>按组分别生成回应</label>
  {!!value.length&&<><p className="facing-hint">每个非空分组调用一次文字API，按组依次回应。未开启时沿用一次请求；停止或失败后可只继续未完成的组。</p>
  {value.map((group,index)=><label key={group.id}>分组名称<input value={group.name} onChange={e=>onChange(value.map((g,i)=>i===index?{...g,name:e.target.value}:g))}/></label>)}
  {ids.map(id=><label key={id}>{characters.find(char=>char.id===id)?.name}<select aria-label={`${characters.find(char=>char.id===id)?.name}的分组`} value={value.find(g=>g.characterIds.includes(id))?.id??value[0].id} onChange={e=>onChange(value.map(group=>({...group,characterIds:group.id===e.target.value?[...group.characterIds.filter(peer=>peer!==id),id]:group.characterIds.filter(peer=>peer!==id)})))}>{value.map(group=><option key={group.id} value={group.id}>{group.name}</option>)}</select></label>)}
  <button type="button" className="facing-small" disabled={value.length>=ids.length} onClick={()=>onChange([...value,{id:facingId(),name:`第${value.length+1}组`,characterIds:[]}])}>增加分组</button></>}
 </fieldset>;
}
