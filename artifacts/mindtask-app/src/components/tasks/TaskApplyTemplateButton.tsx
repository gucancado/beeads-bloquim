import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { customFetch } from "@workspace/api-client-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

interface Template {
  id: string;
  name: string | null;
  title: string | null;
}

export function TaskApplyTemplateButton({
  taskId,
  status,
  onApplied,
  portalContainer,
}: {
  taskId: string | null;
  status: string;
  onApplied: () => void;
  portalContainer?: HTMLElement | null;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [confirming, setConfirming] = useState<Template | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const enabled = status === "draft" && !!taskId;

  const { data: templates, isLoading } = useQuery<Template[]>({
    queryKey: ["/api/task-templates"],
    queryFn: () => customFetch("/api/task-templates"),
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const applyMut = useMutation({
    mutationFn: (templateId: string) =>
      customFetch(`/api/task-templates/${templateId}/apply`, {
        method: "POST",
        body: JSON.stringify({ taskId }),
      }),
    onSuccess: () => {
      toast({ title: "modelo aplicado" });
      setConfirming(null);
      onApplied();
    },
    onError: (e: unknown) => {
      const msg = (e as { body?: { error?: string } })?.body?.error || "erro ao aplicar modelo";
      toast({ title: msg, variant: "destructive" });
    },
  });

  const handleClick = () => {
    if (!enabled) {
      toast({ title: "só é possível aplicar modelo em tarefas em rascunho" });
      return;
    }
    if (buttonRef.current) {
      const r = buttonRef.current.getBoundingClientRect();
      if (portalContainer) {
        const c = portalContainer.getBoundingClientRect();
        setPos({
          top: r.bottom - c.top + portalContainer.scrollTop + 4,
          left: Math.max(0, Math.min(r.left - c.left + portalContainer.scrollLeft - 200, portalContainer.clientWidth - 230)),
        });
      } else {
        setPos({
          top: Math.min(r.bottom + 4, window.innerHeight - 250),
          left: Math.max(4, Math.min(r.left - 200, window.innerWidth - 240)),
        });
      }
    }
    setOpen((v) => !v);
  };

  const displayName = (t: Template) =>
    (t.name && t.name.trim()) || (t.title && t.title.trim()) || "modelo sem nome";

  return (
    <>
      <Button
        ref={buttonRef}
        variant="ghost"
        size="icon"
        onClick={handleClick}
        className={`h-7 w-7 shrink-0 rounded-lg ${enabled ? "text-muted-foreground hover:text-primary hover:bg-primary/10" : "text-muted-foreground/40 cursor-not-allowed hover:bg-transparent"}`}
        title={enabled ? "aplicar modelo" : "só é possível aplicar modelo em tarefas em rascunho"}
      >
        <FileText className="w-3.5 h-3.5" />
      </Button>
      {open && createPortal(
        <div
          ref={menuRef}
          style={{ position: portalContainer ? "absolute" : "fixed", top: pos.top, left: pos.left, zIndex: 9999 }}
          className="bg-popover border border-border rounded-xl shadow-lg w-56 max-h-64 overflow-y-auto py-1"
        >
          {isLoading ? (
            <div className="px-3 py-4 flex items-center justify-center">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          ) : !templates || templates.length === 0 ? (
            <div className="px-3 py-3 text-xs text-muted-foreground text-center lowercase">
              você ainda não tem modelos
            </div>
          ) : (
            templates.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setOpen(false);
                  setConfirming(t);
                }}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors truncate"
                title={displayName(t)}
              >
                {displayName(t)}
              </button>
            ))
          )}
        </div>,
        portalContainer ?? document.body,
      )}

      <AlertDialog open={!!confirming} onOpenChange={(v) => !v && setConfirming(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="lowercase">Aplicar modelo?</AlertDialogTitle>
            <AlertDialogDescription className="lowercase">
              Os campos preenchidos no modelo substituirão os atuais. A descrição será adicionada
              ao final e as subtarefas do modelo serão acrescentadas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl lowercase">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-xl lowercase"
              onClick={(e) => {
                e.preventDefault();
                if (confirming) applyMut.mutate(confirming.id);
              }}
            >
              {applyMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Aplicar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
