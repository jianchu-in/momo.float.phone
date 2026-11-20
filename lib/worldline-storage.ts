export type Worldline = {
  id: string;
  name: string;
  background: string;
  updatedAt: string;
  progressHistory: Array<{ recordedAt: string; text: string }>;
};

export function activeWorldline(): Worldline | null {
  return null;
}

export function worldlineEnabledForApp(world: Worldline | null, appId: string): boolean {
  return false;
}

export function worldlineEventsForCharacter(characterId: string): Array<{
  event: { occurredAt: string; title: string; detail: string };
  perspective: string;
  access: string;
}> {
  return [];
}
