import { toast as sonnerToast } from "@beeads/ui";

/**
 * Compat shim — translates the old shadcn useToast API (Radix-based) to the
 * sonner-based toast exported by @beeads/ui. Keeps the call sites unchanged
 * (toast({title, description, variant: "destructive"|...})) while we migrate.
 */

interface ToastInput {
  title?: React.ReactNode;
  description?: React.ReactNode;
  variant?: "default" | "destructive" | "success" | "warning" | string;
  duration?: number;
  // Other shadcn fields are ignored — kept here for type back-compat
  action?: unknown;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  id?: string;
}

function toString(node: React.ReactNode): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  return "";
}

function toast(input: ToastInput) {
  const title = toString(input.title);
  const description = input.description as string | undefined;
  const opts: Parameters<typeof sonnerToast>[1] = {
    description: description as React.ReactNode,
    duration: input.duration,
  };

  let id: string | number;
  if (input.variant === "destructive") {
    id = sonnerToast.error(title || "Erro", opts);
  } else if (input.variant === "success") {
    id = sonnerToast.success(title || "Ok", opts);
  } else if (input.variant === "warning") {
    id = sonnerToast.warning(title || "Atenção", opts);
  } else {
    id = sonnerToast(title || "", opts);
  }

  return {
    id: String(id),
    dismiss: () => sonnerToast.dismiss(id),
    update: () => undefined,
  };
}

function useToast() {
  return {
    toast,
    dismiss: (toastId?: string | number) => sonnerToast.dismiss(toastId),
    toasts: [] as Array<{ id: string }>,
  };
}

export { useToast, toast };
