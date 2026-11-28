import {splitVisibleCallActions} from "./call-action-text";

export const FACING_REPLY_FORMATS = {
  alternating: "动作＋对话＋动作＋对话（默认）",
  "action-first": "动作＋对话（原格式）",
  free: "动作与对话自由交叉",
} as const;
export type FacingReplyFormat = keyof typeof FACING_REPLY_FORMATS;
export const FACING_DIALOGUE_NOTATIONS = {
  plain: "（动作描述）＋对话（原格式）",
  quoted: "动作描述＋“对话”",
} as const;
export type FacingDialogueNotation = keyof typeof FACING_DIALOGUE_NOTATIONS;
export type FacingSegment = {type: "action" | "dialogue"; text: string};

export function facingReplyFormatInstruction(format?: FacingReplyFormat, notation?: FacingDialogueNotation) {
  const common = 'segments 按实际展示顺序输出数组，每项为 {"type":"action"或"dialogue","text":"内容"}。动作只写可见动作或表情，用中文括号，不写心理活动；dialogue 只写实际说出口的话。';
  const order = format === "action-first"
    ? "生成格式：动作＋对话。先集中写一段动作，再集中写一段台词，保留原来的格式。"
    : format === "free"
      ? "生成格式：动作与对话自由规划交叉。按当前情境自主决定起始类型、段数和交叉顺序，不强制固定四段。"
      : "生成格式：动作＋对话＋动作＋对话。默认按这四段依次推进，两个动作分别配合其后的台词，避免把动作集中到开头；不要为了凑段重复内容。";
  const symbols = notation === "quoted"
    ? "对话符号：动作描述＋“对话”。界面会去掉动作外层括号，并为每段台词加中文双引号；JSON 的 dialogue 段只填台词正文，不要额外添加包裹整段的双引号。台词内部原有引用保留。"
    : "对话符号：（动作描述）＋对话，保留原来的符号格式。";
  return [order, common, symbols, "安静、纯动作等特殊情境可自然省略不适用的段落，不强行让角色说话。所有段落合计遵守回复长度。", "兼容字段 dialogue 和 action 可省略；若填写，只汇总对应内容，不再额外补充或重复一份回复。"].join("\n");
}

export function facingSegmentText(part: FacingSegment, notation?: FacingDialogueNotation) {
  if (notation !== "quoted") return part.text;
  if (part.type === "action") return part.text.replace(/（([^（）]*)）|\(([^()]*)\)/g, (_match, chinese: string | undefined, english: string | undefined) => chinese ?? english ?? "");
  return `“${part.text}”`;
}

/** Parse the quoted display format when editing, retaining the action/speech order. */
export function parseFacingQuotedEdit(text: string): FacingSegment[] {
  const parts: FacingSegment[] = [];
  let cursor = 0, start = 0, depth = 0;
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "“") {
      if (!depth) {
        const action = text.slice(cursor, index).trim();
        if (action) parts.push({type: "action", text: actionText(action)});
        start = index + 1;
      }
      depth++;
    } else if (text[index] === "”" && depth) {
      depth--;
      if (!depth) {
        const dialogue = text.slice(start, index).trim();
        if (dialogue) parts.push({type: "dialogue", text: dialogue});
        cursor = index + 1;
      }
    }
  }
  if (depth) throw new Error("请补全台词的中文双引号：“对话”。");
  const action = text.slice(cursor).trim();
  if (action) parts.push({type: "action", text: actionText(action)});
  return parts;
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
function unwrapDialogue(text: string, notation?: FacingDialogueNotation) {
  const value = text.trim();
  if (notation !== "quoted") return value;
  if (value.startsWith('"') && value.endsWith('"') && !value.slice(1, -1).includes('"')) return value.slice(1, -1).trim();
  if (!value.startsWith("“") || !value.endsWith("”")) return value;
  let depth = 0;
  for (let index = 0; index < value.length; index++) {
    if (value[index] === "“") depth++;
    else if (value[index] === "”") depth--;
    if (!depth && index < value.length - 1) return value;
  }
  return depth === 0 ? value.slice(1, -1).trim() : value;
}
function splitDialogue(text: string, notation?: FacingDialogueNotation) {
  return splitFacingSegments(unwrapDialogue(text, notation)).map(part => part.type === "dialogue"
    ? {...part, text: unwrapDialogue(part.text, notation)} : part).filter(part => part.text);
}
export function normalizeFacingSegments(value: unknown, notation?: FacingDialogueNotation): FacingSegment[] {
  if(!Array.isArray(value))return [];
  return value.flatMap((part):FacingSegment[]=>{
    if(!part||typeof part!=="object"||typeof part.text!=="string"||!part.text.trim())return [];
    if(part.type==="action")return [{type:"action",text:actionText(part.text)}];
    if(part.type==="dialogue")return splitDialogue(part.text,notation);
    return [];
  });
}
export function summarizeFacingSegments(parts: FacingSegment[]) {
  return {dialogue:parts.filter(part=>part.type==="dialogue").map(part=>part.text).join("\n"),action:parts.filter(part=>part.type==="action").map(part=>part.text).join(" ")||undefined};
}
export function parseFacingReplyParts(item: {segments?: unknown; dialogue?: unknown; action?: unknown}, format?: FacingReplyFormat, notation?: FacingDialogueNotation) {
  let segments=normalizeFacingSegments(item.segments,notation);
  const line=typeof item.dialogue==="string"?unwrapDialogue(item.dialogue,notation):"";
  const movement=splitVisibleCallActions(typeof item.action==="string"?item.action.trim():"");
  const actions=[...new Set([...movement.actions,...(movement.speech?[actionText(movement.speech)]:[])])].map(text=>({type:"action" as const,text}));
  if(!segments.length){const lineParts=splitDialogue(line,notation);segments=[...actions.filter(action=>!lineParts.some(part=>part.type==="action"&&part.text===action.text)),...lineParts];}
  else {
    if(!segments.some(part=>part.type==="action"))segments=[...actions,...segments];
    if(!segments.some(part=>part.type==="dialogue"))segments.push(...splitDialogue(line,notation));
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
