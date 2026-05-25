import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageBreadcrumb } from "@/components/layout/PageBreadcrumb";
import { Button } from "@beeads/ui";
import { Skeleton } from "@beeads/ui";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@beeads/ui";
import { AlertCircle, Check, ChevronDown, Copy, Plug, RefreshCw, ShieldCheck, BookOpen, PencilLine } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const MCP_TOOLS_URL = "https://mcp.bloquim.beeads.com.br/tools";
const MCP_ENDPOINT_FALLBACK = "https://mcp.bloquim.beeads.com.br/mcp";

type ToolCategory = "auth" | "read" | "write" | string;

interface McpTool {
  name: string;
  title: string;
  description: string;
  category: ToolCategory;
}

interface McpToolsResponse {
  server: string;
  version: string;
  mcp_endpoint: string;
  tools: McpTool[];
}

const CATEGORY_LABEL: Record<string, string> = {
  auth: "Autenticação",
  read: "Leitura",
  write: "Escrita",
};

const CATEGORY_ORDER: ToolCategory[] = ["auth", "read", "write"];

function categoryIcon(cat: ToolCategory) {
  if (cat === "auth") return <ShieldCheck className="w-4 h-4 text-violet-500" />;
  if (cat === "read") return <BookOpen className="w-4 h-4 text-blue-500" />;
  if (cat === "write") return <PencilLine className="w-4 h-4 text-emerald-500" />;
  return <Plug className="w-4 h-4 text-muted-foreground" />;
}

export default function SettingsMcpPage() {
  const { toast } = useToast();
  const [data, setData] = useState<McpToolsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchTools = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(MCP_TOOLS_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as McpToolsResponse;
      setData(json);
    } catch (err) {
      setError((err as Error).message ?? "fetch failed");
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTools();
  }, []);

  const mcpEndpoint = data?.mcp_endpoint ?? MCP_ENDPOINT_FALLBACK;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(mcpEndpoint);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: "Não foi possível copiar.", variant: "destructive" });
    }
  };

  const grouped = (() => {
    if (!data) return [] as { category: ToolCategory; tools: McpTool[] }[];
    const map = new Map<ToolCategory, McpTool[]>();
    for (const tool of data.tools) {
      const list = map.get(tool.category) ?? [];
      list.push(tool);
      map.set(tool.category, list);
    }
    const ordered: { category: ToolCategory; tools: McpTool[] }[] = [];
    for (const cat of CATEGORY_ORDER) {
      if (map.has(cat)) {
        ordered.push({ category: cat, tools: map.get(cat)! });
        map.delete(cat);
      }
    }
    for (const [category, tools] of map.entries()) {
      ordered.push({ category, tools });
    }
    return ordered;
  })();

  const totalTools = data?.tools.length ?? 0;

  return (
    <AppLayout>
      <div className="flex-1 overflow-auto bg-slate-50 dark:bg-background">
        <div className="max-w-3xl mx-auto p-8 lg:p-12">
          <PageBreadcrumb items={[{ label: "mcp" }]} className="mb-4" />

          {/* Bloco 1 — Header explicativo (genérico) */}
          <div className="mb-6">
            <p className="text-muted-foreground lowercase">
              Conecte o Bloquim a qualquer assistente de IA compatível com MCP (Model Context Protocol).
              Depois de conectar, a IA pode listar suas tarefas, atualizar status, comentar, mudar prazos
              e tudo mais que aparece abaixo, em linguagem natural. A URL pública do servidor MCP do Bloquim é:
            </p>
            <div className="mt-3 flex items-center gap-2 p-2 pl-3 rounded-xl border bg-background">
              <code className="flex-1 min-w-0 font-mono text-xs text-foreground truncate">{mcpEndpoint}</code>
              <Button
                size="sm"
                variant="outline"
                onClick={handleCopy}
                className="rounded-lg shrink-0 h-8 px-3"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 mr-1.5" />
                    <span className="lowercase text-xs">Copiado</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 mr-1.5" />
                    <span className="lowercase text-xs">Copiar</span>
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Bloco 2 — Conectar no Claude (collapsible) */}
          <Collapsible className="rounded-3xl border border-border/60 overflow-hidden mb-6">
            <CollapsibleTrigger className="group/coll w-full p-6 flex items-center gap-4 text-left hover:bg-accent/20 transition-colors">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
                <Plug className="w-6 h-6 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-display font-semibold lowercase">Conectar no claude</h2>
              </div>
              <ChevronDown className="w-5 h-5 text-muted-foreground transition-transform group-data-[state=open]/coll:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent className="overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0">
              <div className="p-6 border-t border-border/50">
                <ol className="space-y-4 text-sm">
                  <li className="flex items-start gap-3">
                    <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center shrink-0 mt-0.5">1</span>
                    <span className="lowercase pt-0.5">abra o claude → configurações → conectores</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center shrink-0 mt-0.5">2</span>
                    <span className="lowercase pt-0.5">clique em "add custom connector"</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center shrink-0 mt-0.5">3</span>
                    <span className="lowercase pt-0.5">
                      nome: <code className="px-1.5 py-0.5 rounded bg-muted text-foreground font-mono text-xs">bloquim</code>
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center shrink-0 mt-0.5">4</span>
                    <div className="flex-1 min-w-0">
                      <p className="lowercase mb-2">url:</p>
                      <div className="flex items-center gap-2 p-2 pl-3 rounded-xl border bg-background">
                        <code className="flex-1 min-w-0 font-mono text-xs text-foreground truncate">{mcpEndpoint}</code>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleCopy}
                          className="rounded-lg shrink-0 h-8 px-3"
                        >
                          {copied ? (
                            <>
                              <Check className="w-3.5 h-3.5 mr-1.5" />
                              <span className="lowercase text-xs">Copiado</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5 mr-1.5" />
                              <span className="lowercase text-xs">Copiar</span>
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center shrink-0 mt-0.5">5</span>
                    <span className="lowercase pt-0.5">salvar → vincular</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center shrink-0 mt-0.5">6</span>
                    <span className="lowercase pt-0.5">
                      faça login com seu email e senha do bloquim e autorize
                    </span>
                  </li>
                </ol>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Bloco 3 — Tools disponíveis */}
          <div className="rounded-3xl border border-border/60 overflow-hidden">
            <div className="p-6 flex items-start justify-between gap-4 border-b border-border/50">
              <div className="min-w-0">
                <h2 className="text-lg font-display font-semibold lowercase">
                  {loading || error
                    ? "Ferramentas disponíveis"
                    : `${totalTools} ${totalTools === 1 ? "ferramenta disponível" : "ferramentas disponíveis"}`}
                </h2>
              </div>
              {!loading && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={fetchTools}
                  className="rounded-xl shrink-0"
                  title="recarregar"
                >
                  <RefreshCw className="w-4 h-4" />
                </Button>
              )}
            </div>

            <div className="p-6">
              {loading ? (
                <div className="space-y-4">
                  {[0, 1, 2].map(i => (
                    <div key={i} className="space-y-2">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-16 w-full rounded-xl" />
                      <Skeleton className="h-16 w-full rounded-xl" />
                    </div>
                  ))}
                </div>
              ) : error ? (
                <div className="flex flex-col items-start gap-4">
                  <div className="flex items-start gap-2 p-4 rounded-xl bg-destructive/10 text-destructive text-sm w-full">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <p className="lowercase flex-1">
                      Não foi possível buscar a lista de ferramentas. tente recarregar a página.
                    </p>
                  </div>
                  <Button onClick={fetchTools} variant="outline" className="rounded-xl">
                    <RefreshCw className="w-4 h-4 mr-2" />
                    <span className="lowercase">Tentar novamente</span>
                  </Button>
                </div>
              ) : grouped.length === 0 ? (
                <p className="text-sm text-muted-foreground italic lowercase">Nenhuma ferramenta exposta.</p>
              ) : (
                <div className="space-y-6">
                  {grouped.map(({ category, tools }) => (
                    <div key={category}>
                      <div className="flex items-center gap-2 mb-3">
                        {categoryIcon(category)}
                        <h3 className="text-xs font-semibold text-muted-foreground tracking-wider lowercase">
                          {CATEGORY_LABEL[category] ?? category}
                        </h3>
                        <span className="text-xs text-muted-foreground/60">({tools.length})</span>
                      </div>
                      <div className="space-y-2">
                        {tools.map(tool => (
                          <div
                            key={tool.name}
                            className="p-4 rounded-xl border bg-background"
                          >
                            <div className="flex items-baseline gap-2 mb-1 flex-wrap">
                              <p className="text-sm font-medium text-foreground">{tool.title}</p>
                              <code className="font-mono text-xs text-muted-foreground">{tool.name}</code>
                            </div>
                            <p className="text-sm text-muted-foreground">{tool.description}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <p className="text-xs text-muted-foreground/70 mt-4 px-2 lowercase flex items-center gap-1">
            <ShieldCheck className="w-3 h-3" />
            <span>O acesso é autorizado via oauth. seus dados de login não saem do bloquim — o cliente de ia recebe só um token de acesso.</span>
          </p>
        </div>
      </div>
    </AppLayout>
  );
}
