import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useLogin } from "@workspace/api-client-react";
import { Compass, Loader2, Mail, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { ThemeToggleFloat } from "@/components/layout/ThemeToggleFloat";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const loginMutation = useLogin({
    mutation: {
      onSuccess: (data) => {
        if (data?.token) {
          localStorage.setItem("mindtask_token", data.token);
        }
        queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
        setLocation("/my-tasks");
      },
      onError: (error: any) => {
        toast({
          title: "Falha ao entrar",
          description: error.message || "Credenciais inválidas. Tente novamente.",
          variant: "destructive"
        });
      }
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loginMutation.mutate({ data: { email, password } });
  };

  return (
    <div className="min-h-screen w-full flex bg-background">
      <ThemeToggleFloat />
      <div className="flex-1 flex flex-col justify-center items-center p-8 lg:p-12 relative z-10">
        <div className="w-full max-w-md space-y-8">
          <div className="text-center">
            <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-xl shadow-primary/25">
              <Compass className="w-8 h-8 text-primary-foreground" />
            </div>
            <p className="text-muted-foreground mt-2">oi! quer ver o que tem no seu bloquim?<br/>então entra aí =)</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6 bg-card p-8 rounded-3xl shadow-xl border border-border/50">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">e-mail</Label>
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
                <Label htmlFor="password">senha</Label>
                <div className="relative">
                  <Lock className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input 
                    id="password" 
                    type="password" 
                    placeholder="••••••••" 
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
              disabled={loginMutation.isPending}
            >
              {loginMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : "entrar"}
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground">
            não tem conta?{" "}
            <Link href="/register">
              <span className="text-primary font-semibold hover:underline cursor-pointer">cria uma, uai</span>
            </Link>
          </p>
        </div>
      </div>
      
    </div>
  );
}
