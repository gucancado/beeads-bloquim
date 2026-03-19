import { useState } from "react";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { useListWorkspaces, useCreateWorkspace } from "@workspace/api-client-react";
import { FolderGit2, Plus, Loader2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

function translateRole(role: string) {
  switch (role) {
    case 'admin': return 'Administrador';
    case 'editor': return 'Editor';
    case 'executor': return 'Executor';
    default: return role;
  }
}

export default function WorkspacesPage() {
  const { data: workspaces, isLoading } = useListWorkspaces();
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const createMutation = useCreateWorkspace({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/workspaces"] });
        setIsOpen(false);
        setName("");
        toast({ title: "Espaço criado com sucesso!" });
      },
      onError: () => {
        toast({ title: "Falha ao criar espaço", variant: "destructive" });
      }
    }
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    createMutation.mutate({ data: { name } });
  };

  return (
    <AppLayout>
      <div className="flex-1 overflow-auto bg-slate-50 dark:bg-background">
        <div className="max-w-6xl mx-auto p-8 lg:p-12">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-12">
            <div>
              <h1 className="text-4xl font-display font-bold text-foreground">Espaços de Trabalho</h1>
              <p className="text-muted-foreground mt-2 text-lg">Gerencie suas equipes e projetos</p>
            </div>

            <Dialog open={isOpen} onOpenChange={setIsOpen}>
              <DialogTrigger asChild>
                <Button className="rounded-xl px-6 h-12 shadow-lg shadow-primary/20 hover:-translate-y-0.5 transition-all text-base">
                  <Plus className="w-5 h-5 mr-2" />
                  Novo Espaço
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md rounded-2xl">
                <DialogHeader>
                  <DialogTitle className="text-2xl font-display">Criar Espaço de Trabalho</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleCreate} className="space-y-6 mt-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Nome do Espaço</label>
                    <Input 
                      placeholder="ex: Equipe de Engenharia, Projetos Pessoais" 
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="h-12 rounded-xl"
                      autoFocus
                    />
                  </div>
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setIsOpen(false)} className="rounded-xl">
                      Cancelar
                    </Button>
                    <Button type="submit" disabled={createMutation.isPending || !name.trim()} className="rounded-xl">
                      {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Criar"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-10 h-10 animate-spin text-primary" />
            </div>
          ) : workspaces?.length === 0 ? (
            <div className="text-center py-24 bg-card rounded-3xl border border-border shadow-sm">
              <div className="w-20 h-20 bg-primary/10 text-primary rounded-full flex items-center justify-center mx-auto mb-6">
                <FolderGit2 className="w-10 h-10" />
              </div>
              <h3 className="text-2xl font-bold font-display text-foreground">Nenhum espaço ainda</h3>
              <p className="text-muted-foreground mt-2 mb-8 max-w-md mx-auto">Crie um espaço para começar a organizar seus mapas mentais e tarefas.</p>
              <Button onClick={() => setIsOpen(true)} className="rounded-xl px-8 h-12">
                Criar primeiro espaço
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {workspaces?.map((ws) => (
                <Link key={ws.id} href={`/workspaces/${ws.id}`}>
                  <div className="group bg-card p-6 rounded-3xl border border-border/60 shadow-sm hover:shadow-xl hover:border-primary/30 transition-all duration-300 cursor-pointer flex flex-col h-full hover:-translate-y-1">
                    <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-6 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                      <FolderGit2 className="w-6 h-6" />
                    </div>
                    <h3 className="text-xl font-bold font-display text-foreground mb-2 group-hover:text-primary transition-colors">{ws.name}</h3>
                    <div className="mt-auto pt-6 flex items-center justify-between text-sm text-muted-foreground">
                      <span>{translateRole(ws.role)}</span>
                      <span className="flex items-center text-primary font-medium opacity-0 group-hover:opacity-100 transition-opacity -translate-x-2 group-hover:translate-x-0 duration-300">
                        Acessar <ArrowRight className="w-4 h-4 ml-1" />
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
