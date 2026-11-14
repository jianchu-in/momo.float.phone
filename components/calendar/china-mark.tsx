export function ChinaCalendarBadge({ badge }: { badge?: string }) {
  return badge ? <small className="calendar-china-badge" data-work={badge === "班" || undefined}>{badge}</small> : null;
}
