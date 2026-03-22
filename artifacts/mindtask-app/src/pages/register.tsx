import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useRegister } from "@workspace/api-client-react";
import { Compass, Loader2, Mail, Lock, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { ThemeToggleFloat } from "@/components/layout/ThemeToggleFloat";

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const registerMutation = useRegister({
    mutation: {
      onSuccess: (data) => {
        if (data?.token) {
          localStorage.setItem("mindtask_token", data.token);
        }
        queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
        setLocation("/workspaces");
      },
      onError: (error: any) => {
        toast({
          title: "Falha no cadastro",
          description: error.message || "Algo deu errado. Tente novamente.",
          variant: "destructive"
        });
      }
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast({
        title: "Senha inválida",
        description: "A senha deve ter pelo menos 8 caracteres.",
        variant: "destructive"
      });
      return;
    }
    registerMutation.mutate({ data: { name, email, password } });
  };

  return (
    <div className="min-h-screen w-full flex bg-background">
      <ThemeToggleFloat />
      <div className="hidden lg:block lg:flex-1 relative overflow-hidden bg-slate-950">
        <img 
          src={`${import.meta.env.BASE_URL}images/auth-bg.png`} 
          alt="Fundo abstrato" 
          className="absolute inset-0 w-full h-full object-cover opacity-80"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 to-transparent" />
        <div className="absolute bottom-16 left-16 right-16">
          <h2 className="text-4xl font-display font-bold text-white mb-4">Comece sua jornada.</h2>
          <p className="text-lg text-slate-300 max-w-lg">Crie planos visuais que se transformam em fluxos de trabalho organizados.</p>
        </div>
      </div>

      <div className="flex-1 flex flex-col justify-center items-center p-8 lg:p-12 relative z-10">
        <div className="w-full max-w-md space-y-8">
          <div className="text-center">
            <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-xl shadow-primary/25">
              <Compass className="w-8 h-8 text-primary-foreground" />
            </div>
            <h1 className="text-3xl font-display font-bold text-foreground">Criar Conta</h1>
            <p className="text-muted-foreground mt-2">Junte-se ao Bloquim hoje</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6 bg-card p-8 rounded-3xl shadow-xl border border-border/50">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Nome completo</Label>
                <div className="relative">
                  <User className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input 
                    id="name" 
                    type="text" 
                    placeholder="João Silva" 
                    className="pl-10 h-12 rounded-xl bg-background"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">E-mail</Label>
                <div className="relative">
                  <Mail className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input 
                    id="email" 
                    type="email" 
                    placeholder="voce@exemplo.com" 
                    className="pl-10 h-12 rounded-xl bg-background"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="password">Senha</Label>
                <div className="relative">
                  <Lock className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input 
                    id="password" 
                    type="password" 
                    placeholder="Mín. 8 caracteres" 
                    className="pl-10 h-12 rounded-xl bg-background"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
              </div>
            </div>

            <Button 
              type="submit" 
              className="w-full h-12 text-base font-semibold rounded-xl shadow-lg shadow-primary/25 hover:-translate-y-0.5 transition-all"
              disabled={registerMutation.isPending}
            >
              {registerMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : "Criar Conta"}
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground">
            Já tem uma conta?{" "}
            <Link href="/login">
              <span className="text-primary font-semibold hover:underline cursor-pointer">Entre aqui</span>
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
