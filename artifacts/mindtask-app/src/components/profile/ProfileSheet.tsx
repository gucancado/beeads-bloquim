import { useState, useEffect } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Save, Building2, Pencil, EyeOff } from "lucide-react";
import { useMyWorkspaces, useUpdateMe } from "@/hooks/useProfile";
import { useGetMe } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

interface ProfileSheetProps {
  open: boolean;
  onClose: () => void;
}

function translateRole(role: string) {
  switch (role) {
    case "admin": return "Administrador";
    case "editor": return "Editor";
    case "executor": return "Executor";
    default: return role;
  }
}

function roleColor(role: string) {
  switch (role) {
    case "admin": return "bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-400 dark:border-violet-800";
    case "editor": return "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800";
    default: return "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800/60 dark:text-slate-400 dark:border-slate-700";
  }
}

export function ProfileSheet({ open, onClose }: ProfileSheetProps) {
  const { data: user } = useGetMe({ query: { retry: false } });
  const { data: myWorkspaces, isLoading: loadingWorkspaces } = useMyWorkspaces();
  const updateMe = useUpdateMe();
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [editingName, setEditingName] = useState(false);

  useEffect(() => {
    if (user?.name) setName(user.name);
  }, [user?.name]);

  const handleSaveName = async () => {
    if (!name.trim() || name.trim() === user?.name) {
      setEditingName(false);
      return;
    }
    try {
      await updateMe.mutateAsync(name.trim());
      setEditingName(false);
      toast({ title: "Nome atualizado com sucesso." });
    } catch {
      toast({ title: "Erro ao atualizar nome.", variant: "destructive" });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSaveName();
    if (e.key === "Escape") { setName(user?.name ?? ""); setEditingName(false); }
  };

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent
        side="right"
        className="w-[420px] sm:w-[480px] p-0 flex flex-col overflow-y-auto"
      >
        <SheetTitle className="sr-only">Perfil do usuário</SheetTitle>
        {/* Header */}
        <div className="p-6 border-b bg-slate-50 dark:bg-slate-900">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-primary/15 text-primary flex items-center justify-center font-bold text-2xl shrink-0 shadow-sm">
              {user?.name?.charAt(0).toUpperCase() ?? "?"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Perfil do usuário</p>
              <p className="text-sm text-muted-foreground truncate">{user?.email}</p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-7 flex-1">

          {/* Name section */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">
              Nome
            </label>
            {editingName ? (
              <div className="flex gap-2">
                <Input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  onKeyDown={handleKeyDown}
                  autoFocus
                  className="rounded-xl bg-background flex-1"
                  placeholder="Seu nome"
                />
                <Button
                  size="sm"
                  className="rounded-xl px-3"
                  onClick={handleSaveName}
                  disabled={updateMe.isPending}
                >
                  {updateMe.isPending
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <Save className="w-4 h-4" />}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="rounded-xl px-3"
                  onClick={() => { setName(user?.name ?? ""); setEditingName(false); }}
                >
                  Cancelar
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2 group">
                <span className="text-base font-medium text-foreground flex-1">{user?.name}</span>
                <button
                  onClick={() => setEditingName(true)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground"
                  title="Editar nome"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Email (read-only) */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">
              E-mail
            </label>
            <p className="text-base text-muted-foreground">{user?.email}</p>
          </div>

          {/* Workspaces */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Espaços de trabalho
              </label>
              {myWorkspaces && (
                <span className="text-xs text-muted-foreground/60">({myWorkspaces.length})</span>
              )}
            </div>

            {loadingWorkspaces ? (
              <div className="flex items-center gap-2 py-6 justify-center text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">Carregando...</span>
              </div>
            ) : myWorkspaces?.length === 0 ? (
              <p className="text-sm text-muted-foreground italic py-4 text-center">
                Você ainda não pertence a nenhum espaço.
              </p>
            ) : (
              <div className="space-y-2">
                {myWorkspaces?.map(ws => (
                  <div
                    key={ws.id}
                    className="flex items-center gap-3 p-3 rounded-xl border bg-background hover:bg-accent/30 transition-colors"
                  >
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Building2 className="w-4 h-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-medium truncate">{ws.name}</p>
                        {ws.hidden && (
                          <EyeOff className="w-3 h-3 text-muted-foreground/50 shrink-0" title="Oculto" />
                        )}
                      </div>
                    </div>
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border shrink-0 ${roleColor(ws.role)}`}>
                      {translateRole(ws.role)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
