export type ReverseLine = {
  original: string;
  translation?: string;
};

export async function requestReverseJson(
  characterId: string,
  prompt: string,
  signal?: AbortSignal,
  history: unknown[] = [],
  appId = 'reverse'
): Promise<Record<string, unknown>> {
  return { continue: false, speech: [], messages: [] };
}

export function reverseLineText(line: ReverseLine): string {
  if (!line) return '';
  if (line.translation && line.translation.trim() && line.translation !== line.original) {
    return `${line.original}\n(${line.translation})`;
  }
  return line.original || '';
}
