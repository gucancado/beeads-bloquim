import type { TodayEvent } from "@/hooks/useGoogleCalendar";

export function EventRow({ event }: { event: TodayEvent }) {
  const time = event.allDay ? "" : formatTimeRange(event.start, event.end);
  const inner = (
    <div className="flex items-start gap-3 p-3 rounded-xl bg-transparent border border-transparent hover:border-border/60 transition-colors">
      <span
        className="w-1 self-stretch rounded-full shrink-0 mt-0.5"
        style={{ backgroundColor: event.calendarColor ?? "#888" }}
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{event.title}</p>
        <div className="flex flex-wrap items-center gap-x-2 mt-0.5">
          {time && <span className="text-xs text-muted-foreground tabular-nums">{time}</span>}
          {event.location && (
            <span className="text-xs text-muted-foreground truncate">· {event.location}</span>
          )}
          <span className="text-[11px] text-muted-foreground/70 truncate lowercase">· {event.calendarName}</span>
        </div>
      </div>
    </div>
  );
  if (event.htmlLink) {
    return <a href={event.htmlLink} target="_blank" rel="noreferrer" className="block">{inner}</a>;
  }
  return inner;
}

export function formatTimeRange(startISO: string, endISO: string): string {
  try {
    const s = new Date(startISO);
    const e = new Date(endISO);
    const fmt = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
    return `${fmt.format(s)} – ${fmt.format(e)}`;
  } catch {
    return "";
  }
}
