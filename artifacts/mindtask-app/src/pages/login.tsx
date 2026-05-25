import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useLogin } from "@workspace/api-client-react";
import { NotebookPen, Loader2, Mail, Lock } from "lucide-react";
import { Button } from "@beeads/ui";
import { Input } from "@beeads/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { ThemeToggleFloat } from "@/components/layout/ThemeToggleFloat";
import { readReturnUrl, withReturnUrl } from "@/lib/return-url";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const loginMutation = useLogin({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
        const ret = readReturnUrl();
        if (ret) {
          // full-page nav porque pode ser cross-subdomain (ex.: painel.beeads.com.br)
          window.location.href = ret;
          return;
        }
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
    <div className="min-h-screen w-full flex bg-background relative">
      <ThemeToggleFloat />
      <div className="flex-1 flex flex-col justify-center items-center p-8 lg:p-12 relative z-10">
        <div className="w-full max-w-md space-y-8">
          <div className="text-center">
            <NotebookPen className="w-14 h-14 text-primary mx-auto mb-6" />
            <p className="text-muted-foreground mt-2">oi! quer ver o que tem no seu bloquim?<br/>então entra aí =)</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6 p-8 rounded-3xl">
            <div className="space-y-4">
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

            <Button
              type="submit"
              className="w-full h-12 text-base font-semibold rounded-xl border bg-primary/10 text-primary border-primary hover:bg-primary/15 dark:bg-primary/15 dark:hover:bg-primary/20 hover:-translate-y-0.5 transition-all"
              disabled={loginMutation.isPending}
            >
              {loginMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : "entrar"}
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground">
            não tem conta?{" "}
            <Link href={withReturnUrl("/register")}>
              <span className="text-primary font-semibold hover:underline cursor-pointer">cria uma, uai</span>
            </Link>
          </p>
        </div>
      </div>
      <footer className="absolute bottom-0 left-0 right-0 py-4 px-6 flex items-center justify-center gap-4 text-xs text-muted-foreground/80">
        <Link href="/privacidade" className="hover:text-foreground hover:underline lowercase">política de privacidade</Link>
        <span aria-hidden="true">·</span>
        <Link href="/termos" className="hover:text-foreground hover:underline lowercase">termos de serviço</Link>
      </footer>
    </div>
  );
}
