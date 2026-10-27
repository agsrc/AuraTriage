import type { EscalationSummary } from "@contracts";
import { Badge } from "../components/Badge";
import { CATEGORY_LABELS, formatFull, formatTime, REASON_LABELS } from "../lib/labels";

interface QueueListProps {
  items: EscalationSummary[] | null;
  selectedThreadId: string | undefined;
  onSelect(threadId: string): void;
  emptyText: string;
}

export function QueueList({ items, selectedThreadId, onSelect, emptyText }: QueueListProps) {
  if (items === null) {
    return <p className="p-4 text-sm text-slate-600">Loading…</p>;
  }
  if (items.length === 0) {
    return <p className="p-4 text-sm text-slate-600">{emptyText}</p>;
  }
  return (
    <ul className="divide-y divide-slate-100">
      {items.map((item) => {
        const selected = item.threadId === selectedThreadId;
        return (
          <li key={`${item.threadId}-${item.createdAt}`}>
            <button
              type="button"
              aria-current={selected ? "true" : undefined}
              onClick={() => onSelect(item.threadId)}
              className={`block w-full px-4 py-3 text-left hover:bg-slate-50 ${selected ? "bg-brand-50" : ""}`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-medium">Patient {item.patientId}</span>
                <time
                  dateTime={item.createdAt}
                  title={formatFull(item.createdAt)}
                  className="text-xs text-slate-600"
                >
                  {formatTime(item.createdAt)}
                </time>
              </span>
              <span className="mt-1.5 flex flex-wrap gap-1.5">
                <Badge tone={item.reason === "red_flag" ? "red" : "amber"}>
                  {REASON_LABELS[item.reason]}
                </Badge>
                {item.categories.map((category) => (
                  <Badge key={category} tone="slate">
                    {CATEGORY_LABELS[category]}
                  </Badge>
                ))}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
