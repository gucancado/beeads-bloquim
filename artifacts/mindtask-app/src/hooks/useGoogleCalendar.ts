import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const cf = (url: string, options?: RequestInit) =>
  fetch(url, {
    ...options,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
  });

async function jsonOrThrow(res: Response) {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      msg = data.message ?? msg;
      const err = new Error(msg) as Error & { status?: number };
      err.status = res.status;
      throw err;
    } catch (parseErr) {
      if (parseErr instanceof Error && (parseErr as Error & { status?: number }).status) throw parseErr;
      const err = new Error(msg) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
  }
  return res.json();
}

export interface GoogleCalendarStatus {
  connected: boolean;
  googleAccountEmail: string | null;
}

export interface CalendarPref {
  id: string;
  name: string;
  color: string | null;
  primary: boolean;
  enabled: boolean;
}

export interface TodayEvent {
  id: string;
  calendarId: string;
  calendarName: string;
  calendarColor: string | null;
  title: string;
  location: string | null;
  htmlLink: string | null;
  allDay: boolean;
  start: string;
  end: string;
}

export function useGoogleCalendarStatus() {
  return useQuery<GoogleCalendarStatus>({
    queryKey: ["/api/integrations/google-calendar/status"],
    queryFn: () => cf("/api/integrations/google-calendar/status").then(jsonOrThrow),
  });
}

export function useGoogleCalendarAuthUrl() {
  return useMutation({
    mutationFn: async () => {
      const data = await cf("/api/integrations/google-calendar/auth-url").then(jsonOrThrow) as { url: string };
      return data.url;
    },
  });
}

export function useGoogleCalendarDisconnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => cf("/api/integrations/google-calendar/disconnect", { method: "POST" }).then(jsonOrThrow),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/integrations/google-calendar/status"] });
      qc.invalidateQueries({ queryKey: ["/api/integrations/google-calendar/calendars"] });
      qc.invalidateQueries({ queryKey: ["/api/integrations/google-calendar/today-events"] });
    },
  });
}

export function useGoogleCalendarList(enabled: boolean) {
  return useQuery<CalendarPref[]>({
    queryKey: ["/api/integrations/google-calendar/calendars"],
    queryFn: () => cf("/api/integrations/google-calendar/calendars").then(jsonOrThrow),
    enabled,
  });
}

export function useToggleCalendar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ calendarId, enabled }: { calendarId: string; enabled: boolean }) =>
      cf(`/api/integrations/google-calendar/calendars/${encodeURIComponent(calendarId)}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      }).then(jsonOrThrow),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/integrations/google-calendar/calendars"] });
      qc.invalidateQueries({ queryKey: ["/api/integrations/google-calendar/today-events"] });
    },
  });
}

export function useTodayEvents(enabled: boolean) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return useQuery<{ events: TodayEvent[]; cached: boolean; noCalendarsSelected?: boolean }, Error & { status?: number }>({
    queryKey: ["/api/integrations/google-calendar/today-events", tz],
    queryFn: () => cf(`/api/integrations/google-calendar/today-events?tz=${encodeURIComponent(tz)}`).then(jsonOrThrow),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}
