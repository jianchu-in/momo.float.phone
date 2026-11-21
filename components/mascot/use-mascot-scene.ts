"use client";

import { useEffect } from "react";
import { registerMascotScene } from "@/lib/mascot-context";

export function useMascotScene(
  page: string, label: string, fields: Record<string, string>, enabled = true, priority = 0,
) {
  const serialized = JSON.stringify(fields);
  useEffect(() => {
    if (!enabled) return;
    return registerMascotScene({ page, mode: "viewing", label, fields: JSON.parse(serialized) }, priority);
  }, [page, label, serialized, enabled, priority]);
}
