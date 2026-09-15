import { useEffect, useRef, useState } from "react";
import { TaskDetailModal } from "@/components/tasks/TaskDetailModal";
import {
  allowedParentOrigins,
  closedMessage,
  parseParentMessage,
  readyMessage,
  type ChildMessage,
} from "@/lib/embedBridge";

/**
 * `/embed/task` — só o `TaskDetailModal`, para ser embutido num iframe pelo
 * painel (`painel.beeads.com.br`). Sem AppLayout. O nginx libera
 * `frame-ancestors` para o painel SÓ sob `/embed/` (deploy/mindtask-app/nginx.conf).
 *
 * Espelha o uso da página do workspace (`pages/workspaces/detail.tsx`): o modal
 * cria a tarefa ao abrir e salva campo a campo; `onAutoCreated`/`onDuplicated`
 * trocam o `taskId` local em vez de navegar.
 *
 * A página fica montada entre aberturas (iframe "quente"): o pai só esconde o
 * iframe no `closed`, nunca o desmonta — o save do título no fechamento não é
 * aguardado pelo modal e morreria junto com o documento.
 */
export default function EmbedTaskPage() {
  const [allowed] = useState(() => allowedParentOrigins(import.meta.env.DEV));
  const [open, setOpen] = useState(false);
  const [workspaceId, setWorkspaceId] = useState("");
  const [taskId, setTaskId] = useState<string | null>(null);
  const parentOriginRef = useRef<string | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  function cancelPendingClose() {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  function postToParent(msg: ChildMessage) {
    const origin = parentOriginRef.current;
    if (origin) window.parent.postMessage(msg, origin);
  }

  // Fundo transparente: o painel precisa aparecer por trás do backdrop do Dialog.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("embed-transparent");
    return () => root.classList.remove("embed-transparent");
  }, []);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.source !== window.parent) return;
      const msg = parseParentMessage(e.origin, e.data, allowed);
      if (!msg) return;
      parentOriginRef.current = e.origin;
      cancelPendingClose();
      setWorkspaceId(msg.workspaceId);
      setTaskId(msg.taskId);
      setOpen(true);
    }
    window.addEventListener("message", onMessage);
    // Antes do 1º `open` o pai ainda não é conhecido: anuncia a cada origem
    // permitida. postMessage com targetOrigin que não bate é descartado pelo
    // navegador, então nenhuma outra janela recebe.
    if (window.parent !== window) {
      for (const origin of allowed) window.parent.postMessage(readyMessage(), origin);
    }
    return () => window.removeEventListener("message", onMessage);
  }, [allowed]);

  function handleClose() {
    setOpen(false);
    cancelPendingClose();
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      postToParent(closedMessage());
    }, 0);
  }

  function handleDuplicated(newTaskId: string) {
    // O modal chama onClose() e, na mesma pilha, onDuplicated(): cancela o
    // `closed` e reabre com a cópia depois do open=false ser commitado.
    cancelPendingClose();
    setTaskId(newTaskId);
    window.setTimeout(() => setOpen(true), 0);
  }

  return (
    <TaskDetailModal
      workspaceId={workspaceId}
      taskId={taskId}
      open={open}
      onClose={handleClose}
      onAutoCreated={(id) => setTaskId(id)}
      onDuplicated={(id) => handleDuplicated(id)}
    />
  );
}
