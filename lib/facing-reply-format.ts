import {splitVisibleCallActions} from "./call-action-text";

export const FACING_REPLY_FORMATS = {
  alternating: "动作＋对话＋动作＋对话（默认）",
  "action-first": "动作＋对话（原格式）",
  free: "动作与对话自由交叉",
} as const;
export type FacingReplyFormat = keyof typeof FACING_REPLY_FORMATS;
export type FacingSegment = {type: "action" | "dialogue"; text: string};

export function facingReplyFormatInstruction(format?: FacingReplyFormat) {
  const common = 'segments 按实际展示顺序输出数组，每项为 {"type":"action"或"dialogue","text":"内容"}。动作只写可见动作或表情，用中文括号，不写心理活动；dialogue 只写实际说出口的话。';
  const order = format === "action-first"
    ? "生成格式：动作＋对话。先集中写一段动作，再集中写一段台词，保留原来的格式。"
    : format === "free"
      ? "生成格式：动作与对话自由规划交叉。按当前情境自主决定起始类型、段数和交叉顺序，不强制固定四段。"
      : "生成格式：动作＋对话＋动作＋对话。默认按这四段依次推进，两个动作分别配合其后的台词，避免把动作集中到开头；不要为了凑段重复内容。";
  return [order, common, "安静、纯动作等特殊情境可自然省略不适用的段落，不强行让角色说话。所有段落合计遵守回复长度。", "兼容字段 dialogue 和 action 可省略；若填写，只汇总对应内容，不再额外补充或重复一份回复。"].join("\n");
}

function actionText(text: string) {
  const value = text.trim();
  if (!value) return "";
  return value.startsWith("（") && value.endsWith("）") ? value : `（${value.replace(/^\(|\)$/g, "")}）`;
}
/** Preserve interleaving, including legacy replies that put bracketed actions in dialogue. */
export function splitFacingSegments(text: string): FacingSegment[] {
  const result: FacingSegment[] = [];
  let cursor = 0, start = 0, depth = 0;
  function speech(value: string) { if(value.trim()) result.push({type:"dialogue",text:value.trim()}); }
  for(let index=0;index<text.length;index++) {
    const ch=text[index];
    if(ch==="（"||ch==="(") { if(!depth)start=index; depth++; }
    else if((ch==="）"||ch===")")&&depth) {
      depth--;
      if(!depth) { speech(text.slice(cursor,start)); const action=actionText(text.slice(start+1,index));if(action)result.push({type:"action",text:action});cursor=index+1; }
    }
  }
  speech(text.slice(cursor));
  return result;
}
export function normalizeFacingSegments(value: unknown): FacingSegment[] {
  if(!Array.isArray(value))return [];
  return value.flatMap((part):FacingSegment[]=>{
    if(!part||typeof part!=="object"||typeof part.text!=="string"||!part.text.trim())return [];
    if(part.type==="action")return [{type:"action",text:actionText(part.text)}];
    if(part.type==="dialogue")return splitFacingSegments(part.text);
    return [];
  });
}
export function summarizeFacingSegments(parts: FacingSegment[]) {
  return {dialogue:parts.filter(part=>part.type==="dialogue").map(part=>part.text).join("\n"),action:parts.filter(part=>part.type==="action").map(part=>part.text).join(" ")||undefined};
}
export function parseFacingReplyParts(item: {segments?: unknown; dialogue?: unknown; action?: unknown}, format?: FacingReplyFormat) {
  let segments=normalizeFacingSegments(item.segments);
  const line=typeof item.dialogue==="string"?item.dialogue.trim():"";
  const movement=splitVisibleCallActions(typeof item.action==="string"?item.action.trim():"");
  const actions=[...new Set([...movement.actions,...(movement.speech?[actionText(movement.speech)]:[])])].map(text=>({type:"action" as const,text}));
  if(!segments.length){const lineParts=splitFacingSegments(line);segments=[...actions.filter(action=>!lineParts.some(part=>part.type==="action"&&part.text===action.text)),...lineParts];}
  else {
    if(!segments.some(part=>part.type==="action"))segments=[...actions,...segments];
    if(!segments.some(part=>part.type==="dialogue"))segments.push(...splitFacingSegments(line));
  }
  const summary=summarizeFacingSegments(segments);
  if(format==="action-first")segments=[...(summary.action?[{type:"action" as const,text:summary.action}]:[]),...(summary.dialogue?[{type:"dialogue" as const,text:summary.dialogue}]:[])];
  return {...summary,segments};
}
/** Older edits may only update the legacy fields; never display stale structured parts. */
export function facingVisibleSegments(turn: {text:string;action?:string;segments?:FacingSegment[]}) {
  const parts=normalizeFacingSegments(turn.segments),summary=summarizeFacingSegments(parts);
  if(parts.length&&summary.dialogue===turn.text&&(summary.action??"")===(turn.action??""))return parts;
  return [...(turn.action?[{type:"action" as const,text:turn.action}]:[]),...(turn.text?[{type:"dialogue" as const,text:turn.text}]:[])];
}
