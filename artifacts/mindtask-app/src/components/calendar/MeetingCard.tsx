import { MeetingItem } from "@/components/meetings/MeetingItem";
import type { Meeting } from "@/components/meetings/useMeetings";
import type { CalendarMeeting } from "@/lib/calendar/placement";

export function MeetingCard({ meeting, onTriage }: { meeting: CalendarMeeting; onTriage: (m: Meeting) => void }) {
  return (
    <div className="rounded-2xl border-2 border-border bg-card shadow-sm">
      <MeetingItem meeting={meeting} onTriage={onTriage} />
    </div>
  );
}
