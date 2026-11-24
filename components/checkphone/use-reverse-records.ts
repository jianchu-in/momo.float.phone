import { useEffect, useState } from "react";
import { hydrateKvDb } from "@/lib/kv-db";
import { CHAT_SCOPE_UPDATED_EVENT } from "@/lib/chat-scope-storage";
import { loadReverseSessionSummaries, REVERSE_RECORDS_UPDATED_EVENT, reverseScope } from "@/lib/reverse-phone-storage";
import type { ReverseScope } from "@/lib/reverse-phone-types";

export function useReverseRecords(scope: ReverseScope) {
  const [records, setRecords] = useState(() => loadReverseSessionSummaries(scope));
  useEffect(() => {
    let alive = true;
    const refresh = () => { if (alive) setRecords(reverseScope().key === scope.key ? loadReverseSessionSummaries(scope) : []); };
    refresh();
    void hydrateKvDb().then(refresh).catch(error => console.warn("查岗记录读取失败", error));
    window.addEventListener(REVERSE_RECORDS_UPDATED_EVENT, refresh);
    window.addEventListener(CHAT_SCOPE_UPDATED_EVENT, refresh);
    return () => { alive = false; window.removeEventListener(REVERSE_RECORDS_UPDATED_EVENT, refresh); window.removeEventListener(CHAT_SCOPE_UPDATED_EVENT, refresh); };
  }, [scope.key]);
  return reverseScope().key === scope.key ? records.filter(record => record.scope.key === scope.key) : [];
}
