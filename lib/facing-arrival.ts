/** Persistent facts about an arrival; the text model must not infer these from who speaks first. */
export type FacingArrival = {
  kind: "together" | "visit" | "alone";
  companionIds: string[];
  encounteredIds: string[];
  visitId: string;
};

export function facingArrival(visitId: string, companionIds: string[], participantIds: string[]): FacingArrival {
  const companions = [...new Set(companionIds.filter(id => participantIds.includes(id)))];
  const encountered = [...new Set(participantIds)].filter(id => !companions.includes(id));
  return { visitId, kind: companions.length ? "together" : encountered.length ? "visit" : "alone", companionIds: companions, encounteredIds: encountered };
}

export function facingArrivalText(destination: string, arrival: FacingArrival, names: Record<string, string>, secret = false) {
  const companions = arrival.companionIds.map(id => names[id] ?? id).join("、");
  if (companions) return `（我和${companions}一起前往并抵达${destination}。我们是同行到达，继续刚才的相处。）`;
  return secret ? `（独自悄悄来到${destination}，暂时在一旁观察。）` : `（独自来到${destination}。）`;
}

export function facingArrivalInstruction(arrival: FacingArrival | undefined, names: Record<string, string>) {
  if (!arrival) return "旧记录未保存同行关系，不根据发言顺序或当前名单猜测谁先在这里。";
  const label = (ids: string[]) => ids.map(id => ({ id, name: names[id] ?? id }));
  return [
    "【本次实际抵达关系】以下是程序保存的已发生事实，优先于旧地图动向和角色近期记忆。",
    JSON.stringify({ 到达方式: arrival.kind, 与用户同行抵达: label(arrival.companionIds), 原本就在目的地的角色: label(arrival.encounteredIds) }),
    arrival.companionIds.length ? "同行角色和用户一起走到目的地，不得写成原本就在此地等候、偶遇用户或看见用户独自来了；旧动向即使显示同一人在此，也不能把他重复当作留在原地的人。" : "",
    arrival.encounteredIds.length ? "只有明确列为原本就在目的地的人，才按用户到访或偶遇处理；不要把他们写成同行者。" : "没有确认原本在目的地的人，不自行补出角色在这里等候。",
    "抵达事实已经发生，后续回复继续当地互动，不在每一轮重新抵达或重新打招呼。",
  ].filter(Boolean).join("\n");
}
