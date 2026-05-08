import type { ReactNode } from "react";

// Vertical-timeline row primitive: dot + connector + content.
// Originally inlined in WorkerProfile.tsx; extracted so WorkerHealthTimeline
// can reuse the same visual without duplicating the markup.
export function TimelineNode({
  date,
  isLast,
  isFuture,
  dotClass,
  children,
}: {
  date: string;
  isLast: boolean;
  isFuture?: boolean;
  dotClass: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="flex gap-4">
      {/* Left: dot + line */}
      <div className="flex flex-col items-center">
        <div className={`mt-1 h-3 w-3 rounded-full shrink-0 border-2 ${isFuture ? "border-dashed bg-white border-gray-400" : dotClass}`} />
        {!isLast && <div className={`mt-1 flex-1 w-px ${isFuture ? "border-l-2 border-dashed border-gray-300" : "bg-gray-200"}`} style={{ minHeight: 32 }} />}
      </div>
      {/* Right: content */}
      <div className="flex-1 pb-5 min-w-0">
        <p className="text-xs text-muted-foreground mb-1">{date}</p>
        {children}
      </div>
    </div>
  );
}
