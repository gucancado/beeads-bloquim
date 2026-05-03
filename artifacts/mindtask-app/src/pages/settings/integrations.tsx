import { useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Loader2, Calendar, ExternalLink, Unplug, AlertCircle, Plug } from "lucide-react";
import {
  useGoogleCalendarStatus,
  useGoogleCalendarAuthUrl,
  useGoogleCalendarDisconnect,
  useGoogleCalendarList,
  useToggleCalendar,
} from "@/hooks/useGoogleCalendar";
import { useToast } from "@/hooks/use-toast";

export default function SettingsIntegrationsPage() {
  const { data: status, isLoading: statusLoading } = useGoogleCalendarStatus();
  const authUrlMut = useGoogleCalendarAuthUrl();
  const disconnectMut = useGoogleCalendarDisconnect();
  const { data: calendars, isLoading: calsLoading, error: calsError } = useGoogleCalendarList(!!status?.connected);
  const toggleMut = useToggleCalendar();
  const { toast } = useToast();

  useEffect(() => {
    const url = new URL(window.location.href);
    const flag = url.searchParams.get("google_calendar");
    if (flag === "connected") {
      toast({ title: "Conta Google conectada com sucesso." });
    } else if (flag === "error") {
      const msg = url.searchParams.get("message");
      toast({ title: "Falha ao conectar Google Agenda.", description: msg ?? undefined, variant: "destructive" });
    }
    if (flag) {
      url.searchParams.delete("google_calendar");
      url.searchParams.delete("message");
      window.history.replaceState({}, "", url.pathname + (url.search || ""));
    }
  }, [toast]);

  const handleConnect = async () => {
    try {
      const url = await authUrlMut.mutateAsync();
      window.location.href = url;
    } catch (err) {
      toast({ title: "Erro ao iniciar conexão.", variant: "destructive" });
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnectMut.mutateAsync();
      toast({ title: "Conta Google desconectada." });
    } catch {
      toast({ title: "Erro ao desconectar.", variant: "destructive" });
    }
  };

  const handleToggle = async (calendarId: string, enabled: boolean) => {
    try {
      await toggleMut.mutateAsync({ calendarId, enabled });
    } catch {
      toast({ title: "Erro ao salvar preferência.", variant: "destructive" });
    }
  };

  return (
    <AppLayout>
      <div className="flex-1 overflow-auto bg-slate-50 dark:bg-background">
        <div className="max-w-3xl mx-auto p-8 lg:p-12">
          <div className="mb-10">
            <h1 className="text-4xl font-display font-bold text-foreground lowercase">Integrações</h1>
            <p className="text-muted-foreground mt-2 lowercase">Conecte serviços externos ao Bloquim.</p>
          </div>

          <div className="bg-card rounded-3xl border border-border/60 shadow-sm overflow-hidden">
            <div className="p-6 flex items-start gap-4 border-b border-border/50">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
                <Calendar className="w-6 h-6 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-display font-semibold lowercase">Google Agenda</h2>
                <p className="text-sm text-muted-foreground mt-1 lowercase">
                  Visualize seus eventos do dia diretamente em "suas tarefas". somente leitura.
                </p>
              </div>
            </div>

            <div className="p-6">
              {statusLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : !status?.connected ? (
                <div className="flex flex-col items-start gap-4">
                  <p className="text-sm text-muted-foreground lowercase">Você ainda não conectou nenhuma conta Google.</p>
                  <Button onClick={handleConnect} disabled={authUrlMut.isPending} className="rounded-xl">
                    {authUrlMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plug className="w-4 h-4 mr-2" />}
                    <span className="lowercase">Conectar conta Google</span>
                  </Button>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-muted-foreground tracking-wider mb-1 lowercase">Conectado como</p>
                      <p className="text-sm font-medium truncate">{status.googleAccountEmail}</p>
                    </div>
                    <Button
                      variant="outline"
                      onClick={handleDisconnect}
                      disabled={disconnectMut.isPending}
                      className="rounded-xl"
                    >
                      {disconnectMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Unplug className="w-4 h-4 mr-2" />}
                      <span className="lowercase">Desconectar</span>
                    </Button>
                  </div>

                  <div>
                    <p className="text-xs font-semibold text-muted-foreground tracking-wider mb-3 lowercase">
                      Agendas exibidas no Bloquim
                    </p>
                    {calsLoading ? (
                      <div className="flex items-center justify-center py-6">
                        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : calsError ? (
                      <div className="flex items-start gap-2 p-4 rounded-xl bg-destructive/10 text-destructive text-sm">
                        <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                        <div className="flex-1">
                          <p className="lowercase">Erro ao carregar agendas. tente reconectar a conta.</p>
                        </div>
                      </div>
                    ) : (calendars ?? []).length === 0 ? (
                      <p className="text-sm text-muted-foreground italic lowercase">Nenhuma agenda encontrada nesta conta.</p>
                    ) : (
                      <div className="space-y-2">
                        {calendars!.map(cal => (
                          <div
                            key={cal.id}
                            className="flex items-center gap-3 p-3 rounded-xl border bg-background"
                          >
                            <span
                              className="w-3 h-3 rounded-full shrink-0 border border-border/40"
                              style={{ backgroundColor: cal.color ?? "#888" }}
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{cal.name}</p>
                              {cal.primary && (
                                <p className="text-xs text-muted-foreground lowercase">Agenda principal</p>
                              )}
                            </div>
                            <Switch
                              checked={cal.enabled}
                              onCheckedChange={(v) => handleToggle(cal.id, v)}
                              disabled={toggleMut.isPending}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <p className="text-xs text-muted-foreground/70 mt-4 px-2 lowercase flex items-center gap-1">
            <ExternalLink className="w-3 h-3" />
            <span>Os tokens são armazenados criptografados. acesso somente leitura ao google agenda.</span>
          </p>
        </div>
      </div>
    </AppLayout>
  );
}
