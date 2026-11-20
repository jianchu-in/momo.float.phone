export function projectMemoryEntry<T>(entry: T): T {
  return entry;
}

export function revokeMemorySources(sources: string[]): void {
  // No-op fallback
}
