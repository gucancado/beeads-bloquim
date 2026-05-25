import { useState, useEffect, useRef } from "react";
import { Sheet, SheetContent, SheetTitle } from "@beeads/ui";
import { PageBreadcrumb } from "@/components/layout/PageBreadcrumb";
import { Button } from "@beeads/ui";
import { Input } from "@beeads/ui";
import { Avatar, AvatarImage, AvatarFallback } from "@beeads/ui";
import { Loader2, Save, Building2, Pencil, EyeOff, Camera, Plug } from "lucide-react";
import { Link } from "wouter";
import { useMyWorkspaces, useUpdateMe } from "@/hooks/useProfile";
import {
  useGetMe,
  type UserClass,
  type UserPronouns,
  type UserResponse,
} from "@workspace/api-client-react";
import { Checkbox } from "@beeads/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@beeads/ui";
import { PhoneInput } from "./PhoneInput";
import { useAvatarUpload } from "@workspace/object-storage-web";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

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

const USER_CLASS_OPTIONS: { value: UserClass; label: string }[] = [
  { value: "analista_dados", label: "Analista de dados" },
  { value: "designer", label: "Designer" },
  { value: "gerente_contas", label: "Gerente de contas" },
  { value: "gestor_midias_sociais", label: "Gestor de mídias sociais" },
  { value: "gestor_trafego", label: "Gestor de tráfego" },
  { value: "tecnico", label: "Técnico" },
];

const PRONOUN_OPTIONS: { value: UserPronouns; label: string }[] = [
  { value: "ela_dela", label: "ela/dela" },
  { value: "ele_dele", label: "ele/dele" },
  { value: "elu_delu", label: "elu/delu" },
  { value: "name_only", label: "usar apenas meu nome" },
];

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
  const { uploadAvatar, isUploading: isUploadingAvatar } = useAvatarUpload();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [editingName, setEditingName] = useState(false);

  // Cast until `useGetMe` regenerates with the extended UserResponse — the
  // backend already returns the new fields, so this just gives us typed access.
  const me = user as UserResponse | undefined;

  useEffect(() => {
    if (user?.name) setName(user.name);
  }, [user?.name]);

  const handleSaveName = async () => {
    if (!name.trim() || name.trim() === user?.name) {
      setEditingName(false);
      return;
    }
    try {
      await updateMe.mutateAsync({ name: name.trim() });
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

  // Autosave is fire-and-forget — the mutation does an optimistic cache
  // update so the UI reflects the change instantly. Errors roll back and
  // surface a toast; success is silent (matches the task-edit UX).
  const handleSaveWhatsapp = (next: string | null) => {
    updateMe.mutate(
      { whatsapp: next },
      { onError: () => toast({ title: "Erro ao atualizar WhatsApp.", variant: "destructive" }) },
    );
  };

  const handleToggleClass = (value: UserClass, checked: boolean) => {
    const current = me?.classes ?? [];
    const next = checked
      ? Array.from(new Set([...current, value]))
      : current.filter((c) => c !== value);
    updateMe.mutate(
      { classes: next },
      { onError: () => toast({ title: "Erro ao atualizar classes.", variant: "destructive" }) },
    );
  };

  const handleChangePronouns = (value: UserPronouns) => {
    if (value === me?.pronouns) return;
    updateMe.mutate(
      { pronouns: value },
      { onError: () => toast({ title: "Erro ao atualizar pronomes.", variant: "destructive" }) },
    );
  };

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast({ title: "Selecione um arquivo de imagem.", variant: "destructive" });
      return;
    }

    try {
      const result = await uploadAvatar(file);
      if (!result) {
        throw new Error("upload failed");
      }
      // The backend already updated the user's avatar_storage_path; just
      // invalidate the cached profile so the new URL renders.
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "Foto de perfil atualizada com sucesso." });
    } catch (err) {
      console.error(err);
      toast({ title: "Erro ao atualizar foto de perfil.", variant: "destructive" });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const avatarUrl = (user as { avatarUrl?: string | null } | undefined)?.avatarUrl;
  const initials = user?.name?.charAt(0).toUpperCase() ?? "?";

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent
        side="right"
        className="w-[420px] sm:w-[480px] p-0 flex flex-col overflow-y-auto"
      >
        <SheetTitle className="sr-only">Perfil do usuário</SheetTitle>
        {/* Header */}
        <div className="p-6 border-b border-border bg-muted/40">
          <PageBreadcrumb items={[{ label: "perfil" }]} className="mb-4" />
          <div className="flex items-center gap-4">
            <div className="relative shrink-0 group">
              <Avatar className="w-14 h-14 rounded-2xl shadow-sm">
                {avatarUrl && <AvatarImage src={avatarUrl} alt={user?.name} className="object-cover" />}
                <AvatarFallback className="rounded-2xl bg-primary/15 text-primary font-bold text-2xl">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <button
                onClick={handleAvatarClick}
                disabled={isUploadingAvatar}
                className="absolute inset-0 rounded-2xl flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                title="alterar foto de perfil"
              >
                {isUploadingAvatar
                  ? <Loader2 className="w-5 h-5 text-white animate-spin" />
                  : <Camera className="w-5 h-5 text-white" />}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-muted-foreground truncate">{user?.email}</p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-7 flex-1">

          {/* Name section */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground tracking-wider mb-2 block lowercase">
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
                  <span className="lowercase">Cancelar</span>
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2 group">
                <span className="text-base font-medium text-foreground flex-1">{user?.name}</span>
                <button
                  onClick={() => setEditingName(true)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground"
                  title="editar nome"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Email (read-only) */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground tracking-wider mb-2 block lowercase">
              E-mail
            </label>
            <p className="text-base text-muted-foreground">{user?.email}</p>
          </div>

          {/* WhatsApp */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground tracking-wider mb-2 block lowercase">
              WhatsApp
            </label>
            <PhoneInput
              value={me?.whatsapp ?? null}
              onCommit={handleSaveWhatsapp}
            />
          </div>

          {/* Pronouns */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground tracking-wider mb-2 block lowercase">
              Pronomes
            </label>
            <Select
              value={me?.pronouns ?? "name_only"}
              onValueChange={(v) => handleChangePronouns(v as UserPronouns)}
            >
              <SelectTrigger className="rounded-xl bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRONOUN_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className="lowercase">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Classes */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground tracking-wider mb-2 block lowercase">
              Classes
            </label>
            <div className="space-y-2">
              {USER_CLASS_OPTIONS.map((opt) => {
                const checked = me?.classes?.includes(opt.value) ?? false;
                return (
                  <label
                    key={opt.value}
                    className="flex items-center gap-3 p-2.5 rounded-xl border bg-background hover:bg-accent/30 transition-colors cursor-pointer"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) => handleToggleClass(opt.value, v === true)}
                    />
                    <span className="text-sm flex-1 lowercase">{opt.label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Integrations */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground tracking-wider mb-2 block lowercase">
              Integrações
            </label>
            <Link href="/settings/integrations">
              <button
                onClick={onClose}
                className="w-full flex items-center gap-3 p-3 rounded-xl border bg-background hover:bg-accent/30 transition-colors text-left"
              >
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Plug className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium lowercase">Google Agenda e outros</p>
                  <p className="text-xs text-muted-foreground lowercase">Conecte serviços externos</p>
                </div>
              </button>
            </Link>
          </div>

          {/* Workspaces */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <label className="text-xs font-semibold text-muted-foreground tracking-wider lowercase">
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
              <p className="text-sm text-muted-foreground italic py-4 text-center lowercase">
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
                          <EyeOff className="w-3 h-3 text-muted-foreground/50 shrink-0" title="oculto" />
                        )}
                      </div>
                    </div>
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border shrink-0 lowercase ${roleColor(ws.role)}`}>
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
