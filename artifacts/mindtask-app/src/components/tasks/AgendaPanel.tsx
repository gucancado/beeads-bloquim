import { useState, useEffect } from "react";
import { Link } from "wouter";
import { ChevronDown, ChevronRight, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { useGoogleCalendarStatus, useTodayEvents, type TodayEvent } from "@/hooks/useGoogleCalendar";
import { Button } from "@beeads/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useMeetings } from "@/components/meetings/useMeetings";
import { MeetingItem } from "@/components/meetings/MeetingItem";

export function AgendaPanel() {
  const [expanded, setExpanded] = useState(false);
  const { data: status, isLoading: statusLoading, isFetched: statusFetched } = useGoogleCalendarStatus();
  const isConnected = !!status?.connected;
  const { data, isLoading: eventsLoading, error, refetch, isFetching } = useTodayEvents(expanded && isConnected);
  const { data: meetingsData } = useMeetings();
  const qc = useQueryClient();

  const reauthRequired = (error as (Error & { status?: number }) | undefined)?.status === 401;

  const events = data?.events ?? [];
  const allDay = events.filter(e => e.allDay);
  const timed = events.filter(e => !e.allDay);
  const meetings = meetingsData ?? [];

  // Abre a agenda automaticamente quando há uma reunião coletando (feedback pós "nova reunião").
  const hasCollecting = meetings.some(m => m.status === "collecting");
  useEffect(() => {
    if (hasCollecting) setExpanded(true);
  }, [hasCollecting]);

  if (statusLoading || !statusFetched) return null;
  // Sem Google Calendar conectado e sem reuniões → nada a exibir.
  if (!isConnected && meetings.length === 0) return null;

  return (
    <div>
      <div className="flex items-center mb-2 px-1">
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-1 text-xs font-light text-muted-foreground lowercase hover:text-foreground transition-colors"
        >
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          <span>agenda</span>
        </button>
        {expanded && isConnected && (
          <button
            onClick={() => {
              qc.invalidateQueries({ queryKey: ["/api/integrations/google-calendar/today-events"] });
              refetch();
            }}
            className="ml-2 text-muted-foreground hover:text-foreground transition-colors"
            title="atualizar"
            aria-label="atualizar eventos"
          >
            <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
          </button>
        )}
      </div>

      {expanded && (
        <div className="px-1 space-y-4">
          {meetings.length > 0 && (
            <Section label="reuniões">
              <div className="space-y-2">
                {meetings.map(m => <MeetingItem key={m.id} meeting={m} />)}
              </div>
            </Section>
          )}

          {isConnected && (
            reauthRequired ? (
              <div className="flex items-start gap-2 p-4 rounded-xl bg-destructive/10 text-destructive text-sm">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="lowercase mb-2">A sessão do google expirou.</p>
                  <Link href="/settings/integrations">
                    <Button size="sm" variant="outline" className="rounded-xl"><span className="lowercase">Reconectar</span></Button>
                  </Link>
                </div>
              </div>
            ) : eventsLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : error ? (
              <div className="flex items-start gap-2 p-4 rounded-xl bg-destructive/10 text-destructive text-sm">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <p className="lowercase">Erro ao carregar eventos.</p>
              </div>
            ) : data?.noCalendarsSelected ? (
              <EmptyState
                text="você ainda não escolheu quais agendas exibir aqui."
                cta={
                  <Link href="/settings/integrations">
                    <Button size="sm" className="rounded-xl"><span className="lowercase">Escolher agendas</span></Button>
                  </Link>
                }
              />
            ) : events.length === 0 ? (
              // Só mostra "sem eventos hoje" se também não houver reuniões (senão a lista não fica vazia).
              meetings.length === 0 ? (
                <EmptyState
                  text="sem eventos hoje."
                  cta={
                    <Link href="/settings/integrations">
                      <Button size="sm" variant="ghost" className="rounded-xl text-xs"><span className="lowercase">Gerenciar agendas</span></Button>
                    </Link>
                  }
                />
              ) : null
            ) : (
              <div className="space-y-4">
                {allDay.length > 0 && (
                  <Section label="dia inteiro">
                    <div className="space-y-2">
                      {allDay.map(ev => <EventRow key={`${ev.calendarId}-${ev.id}`} event={ev} />)}
                    </div>
                  </Section>
                )}
                {timed.length > 0 && (
                  <Section label="hoje">
                    <div className="space-y-2">
                      {timed.map(ev => <EventRow key={`${ev.calendarId}-${ev.id}`} event={ev} />)}
                    </div>
                  </Section>
                )}
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-light text-muted-foreground mb-2 px-1 lowercase">{label}</p>
      {children}
    </div>
  );
}

function EmptyState({ text, cta }: { text: string; cta?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 py-2">
      <p className="text-sm text-muted-foreground lowercase">{text}</p>
      {cta}
    </div>
  );
}

function EventRow({ event }: { event: TodayEvent }) {
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

function formatTimeRange(startISO: string, endISO: string): string {
  try {
    const s = new Date(startISO);
    const e = new Date(endISO);
    const fmt = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
    return `${fmt.format(s)} – ${fmt.format(e)}`;
  } catch {
    return "";
  }
}
