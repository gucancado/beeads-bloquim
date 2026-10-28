import { ReactNode, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { getGetMeQueryKey, useGetMe } from "@workspace/api-client-react";
import { allowedParentOrigins, parseParentCommand, readyMessage } from "@/lib/embedBridge";
import { rememberEmbedParent } from "@/lib/embedParent";

/**
 * Casca das páginas `/embed/workspaces/...` (lista de tarefas e canvas de
 * plano), embutidas num iframe pelo painel. Sem AppLayout.
 *
 * - Anuncia `ready` uma vez na montagem, a cada origem permitida (o pai ainda
 *   não é conhecido; targetOrigin que não bate é descartado pelo navegador).
 * - `init` do pai fixa a origem dele no store (`embedParent`) e guarda o
 *   `returnUrl` para o link de login; `navigate` troca a rota sem empilhar.
 * - Gate de sessão SEM redirecionar para `/login` como o AppLayout faz: dentro
 *   do iframe isso mostraria a tela de login embutida. O link "entrar de novo"
 *   abre o login no topo (`target="_top"`) e volta para o painel.
 */
export function EmbedShell({ children }: { children: ReactNode }) {
  const [allowed] = useState(() => allowedParentOrigins(import.meta.env.DEV));
  const [returnUrl, setReturnUrl] = useState<string | null>(null);
  const [, navigate] = useLocation();
  const { data: user, isLoading } = useGetMe({
    query: { queryKey: getGetMeQueryKey(), retry: false },
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("embed-transparent");
    return () => root.classList.remove("embed-transparent");
  }, []);

  useEffect(() => {
    if (window.parent === window) return;
    for (const origin of allowed) window.parent.postMessage(readyMessage(), origin);
  }, [allowed]);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.source !== window.parent) return;
      const cmd = parseParentCommand(e.origin, e.data, allowed);
      if (!cmd) return;
      if (cmd.type === "init") {
        rememberEmbedParent(e.origin);
        setReturnUrl(cmd.returnUrl);
      } else {
        navigate(cmd.path, { replace: true });
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [allowed, navigate]);

  if (isLoading) {
    return (
      <div className="h-dvh flex items-center justify-center">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="h-dvh flex flex-col items-center justify-center gap-2 text-sm">
        <p>sua sessão do Bloquim expirou</p>
        <a
          className="underline"
          target="_top"
          href={`/login?return_url=${encodeURIComponent(returnUrl ?? "/")}`}
        >
          entrar de novo
        </a>
      </div>
    );
  }

  return <div className="h-dvh flex flex-col overflow-hidden">{children}</div>;
}
