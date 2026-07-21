import { describe, it, expect } from "vitest";
import { mapGoogleEvent } from "../services/googleCalendarService";

describe("mapGoogleEvent", () => {
  it("(a) evento normal: extrai id, iCalUID, summary, hangoutLink, attendees e startDateTime/endDateTime", () => {
    const raw = {
      id: "evt_abc123",
      status: "confirmed",
      iCalUID: "abc123@google.com",
      summary: "Reunião de kickoff",
      description: "Alinhamento inicial",
      location: "Sala 1",
      hangoutLink: "https://meet.google.com/xyz-abcd-efg",
      htmlLink: "https://calendar.google.com/event?eid=evt_abc123",
      start: { dateTime: "2026-07-20T14:00:00-03:00", timeZone: "America/Sao_Paulo" },
      end: { dateTime: "2026-07-20T15:00:00-03:00", timeZone: "America/Sao_Paulo" },
      attendees: [
        { email: "a@beeads.com.br", displayName: "Alice", responseStatus: "accepted" },
        { email: "b@beeads.com.br", responseStatus: "needsAction" },
      ],
    };

    const ev = mapGoogleEvent(raw);

    expect(ev.id).toBe("evt_abc123");
    expect(ev.iCalUID).toBe("abc123@google.com");
    expect(ev.summary).toBe("Reunião de kickoff");
    expect(ev.hangoutLink).toBe("https://meet.google.com/xyz-abcd-efg");
    expect(ev.startDateTime).toBe("2026-07-20T14:00:00-03:00");
    expect(ev.endDateTime).toBe("2026-07-20T15:00:00-03:00");
    expect(ev.recurringEventId).toBeNull();
    expect(ev.originalStartTime).toBeNull();
    expect(ev.attendees).toEqual([
      { email: "a@beeads.com.br", displayName: "Alice", responseStatus: "accepted" },
      { email: "b@beeads.com.br", responseStatus: "needsAction" },
    ]);
  });

  it("(b) ocorrência de recorrente: recurringEventId + originalStartTime.dateTime", () => {
    const raw = {
      id: "evt_recur_20260720",
      status: "confirmed",
      iCalUID: "recur@google.com",
      summary: "Daily standup",
      recurringEventId: "evt_recur_master",
      originalStartTime: { dateTime: "2026-07-20T09:00:00-03:00", timeZone: "America/Sao_Paulo" },
      start: { dateTime: "2026-07-20T09:00:00-03:00", timeZone: "America/Sao_Paulo" },
      end: { dateTime: "2026-07-20T09:15:00-03:00", timeZone: "America/Sao_Paulo" },
    };

    const ev = mapGoogleEvent(raw);

    expect(ev.recurringEventId).toBe("evt_recur_master");
    expect(ev.originalStartTime).toBe("2026-07-20T09:00:00-03:00");
    expect(ev.startDateTime).toBe("2026-07-20T09:00:00-03:00");
    expect(ev.attendees).toEqual([]);
  });

  it("(c) all-day (start.date sem dateTime): startDateTime e endDateTime null", () => {
    const raw = {
      id: "evt_allday",
      status: "confirmed",
      iCalUID: "allday@google.com",
      summary: "Feriado",
      start: { date: "2026-07-20" },
      end: { date: "2026-07-21" },
    };

    const ev = mapGoogleEvent(raw);

    expect(ev.startDateTime).toBeNull();
    expect(ev.endDateTime).toBeNull();
    expect(ev.start.date).toBe("2026-07-20");
    expect(ev.end.date).toBe("2026-07-21");
    expect(ev.hangoutLink).toBeNull();
  });

  it("(d) sem attendees: default []", () => {
    const raw = {
      id: "evt_solo",
      status: "confirmed",
      summary: "Foco individual",
      start: { dateTime: "2026-07-20T16:00:00-03:00" },
      end: { dateTime: "2026-07-20T17:00:00-03:00" },
    };

    const ev = mapGoogleEvent(raw);

    expect(ev.attendees).toEqual([]);
    expect(ev.iCalUID).toBeNull();
  });
});
