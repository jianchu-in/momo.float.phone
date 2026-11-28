export type ReverseVisit = {
  owner: string;
  sessionId: string;
};

export type ReversePageIntent = {
  app?: string;
  entryId?: string;
};

let currentIntent: ReversePageIntent | null = null;

export function activeReverse(): ReverseVisit | null {
  return null;
}

export function reversePageIntent(): ReversePageIntent | null {
  return currentIntent;
}

export function setReversePageIntent(intent: ReversePageIntent | null): void {
  currentIntent = intent;
}

export function subscribeReverse(callback: () => void): () => void {
  return () => {};
}
