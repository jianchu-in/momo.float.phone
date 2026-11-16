function mapParentheticalActions(text: string, map: (action: string) => string): string {
  let result = "";
  let cursor = 0;
  let start = 0;
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    const letter = text[index];
    if (letter === "（" || letter === "(") {
      if (!depth) start = index;
      depth++;
    } else if ((letter === "）" || letter === ")") && depth > 0) {
      depth--;
      if (!depth) {
        result += text.slice(cursor, start) + map(text.slice(start + 1, index).trim());
        cursor = index + 1;
      }
    }
  }
  return result + text.slice(cursor);
}

export function splitVisibleCallActions(text: string) {
  const actions: string[] = [];
  const speech = mapParentheticalActions(text, action => {
    if (action) actions.push(`（${action}）`);
    return "";
  }).replace(/[\t ]+([,!.?，。！？])/g, "$1").trim();
  return { actions, speech };
}

export function formatVideoCallText(text: string, showActions: boolean): string {
  if (!showActions) return splitVisibleCallActions(text).speech;
  return mapParentheticalActions(text, action => action ? `（${action}）` : "").trim();
}

export function videoCallActionInstruction(enabled: boolean): string {
  return enabled
    ? "本轮视频通话已开启动作描述。可以用中文括号「（）」简短描述角色在视频里能被看见的动作或表情，例如「（对着镜头笑了一下）你到家了吗？」。括号外只写实际说出口的话。只在合适时加入动作，不写内心想法。此设置替代预设里对括号动作的限制，其他格式照常。"
    : "本轮视频通话的动作描述已关闭。只输出角色实际说出口的话，省略括号动作和旁白。";
}
