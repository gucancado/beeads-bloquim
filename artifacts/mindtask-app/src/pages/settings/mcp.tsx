import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageBreadcrumb } from "@/components/layout/PageBreadcrumb";
import { Button } from "@beeads/ui";
import { Skeleton } from "@beeads/ui";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@beeads/ui";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Copy,
  Plug,
  RefreshCw,
  ShieldCheck,
  BookOpen,
  PencilLine,
  Sparkles,
  Rocket,
  Github,
  Wand2,
  MessageSquareText,
  CircleHelp,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const MCP_TOOLS_URL = "https://mcp.bloquim.beeads.com.br/tools";
const MCP_ENDPOINT_FALLBACK = "https://mcp.bloquim.beeads.com.br/mcp";
const SKILL_REPO_URL = "https://github.com/gucancado/bloquim-skill";
const SKILL_INSTALL_CMD = "npx skills add gucancado/bloquim-skill";

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

/**
 * Botão de copiar com estado próprio — cada instância é independente (corrige o
 * bug do `copied` compartilhado entre múltiplos botões da página).
 */
function CopyButton({ value, className }: { value: string; className?: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: "Não foi possível copiar.", variant: "destructive" });
    }
  };

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={handleCopy}
      className={`rounded-lg shrink-0 h-8 px-3 ${className ?? ""}`}
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
  );
}

/** Campo monoespaçado (URL/comando) + botão de copiar. */
function CopyableField({ value }: { value: string }) {
  return (
    <div className="flex items-center gap-2 p-2 pl-3 rounded-xl border bg-background">
      <code className="flex-1 min-w-0 font-mono text-xs text-foreground truncate">{value}</code>
      <CopyButton value={value} />
    </div>
  );
}

/** Card de frase-gatilho copiável. */
function TriggerCard({ text, hint }: { text: string; hint?: string }) {
  return (
    <div className="flex items-center gap-2 p-2 pl-3 rounded-xl border bg-background">
      <div className="flex-1 min-w-0">
        <code className="block font-mono text-xs text-foreground truncate">{text}</code>
        {hint && <span className="text-xs text-muted-foreground/70 lowercase">{hint}</span>}
      </div>
      <CopyButton value={text} />
    </div>
  );
}

const STEP_BADGE =
  "w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center shrink-0 mt-0.5";

export default function SettingsMcpPage() {
  const [data, setData] = useState<McpToolsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

          {/* Bloco 1 — Header */}
          <div className="mb-6">
            <h1 className="text-2xl font-display font-medium tracking-tight lowercase mb-1">
              conecte o bloquim ao claude
            </h1>
            <p className="text-muted-foreground lowercase">
              Gerencie tarefas, planos e prazos falando natural — o Claude lê e escreve no seu
              Bloquim. A URL pública do servidor MCP é:
            </p>
            <div className="mt-3">
              <CopyableField value={mcpEndpoint} />
            </div>
          </div>

          {/* Bloco 2 — Conectar em 4 passos (aberto por default) */}
          <Collapsible
            defaultOpen
            className="rounded-3xl border border-border/60 overflow-hidden mb-6"
          >
            <CollapsibleTrigger className="group/coll w-full p-6 flex items-center gap-4 text-left hover:bg-accent/20 transition-colors">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
                <Plug className="w-6 h-6 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-display font-medium tracking-tight lowercase">
                  conectar no claude — 4 passos
                </h2>
              </div>
              <ChevronDown className="w-5 h-5 text-muted-foreground transition-transform group-data-[state=open]/coll:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent className="overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0">
              <div className="p-6 border-t border-border/50">
                <ol className="space-y-4 text-sm">
                  <li className="flex items-start gap-3">
                    <span className={STEP_BADGE}>1</span>
                    <span className="lowercase pt-0.5">
                      pré-requisito: ter conta no bloquim (a mesma deste login).
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className={STEP_BADGE}>2</span>
                    <span className="lowercase pt-0.5">
                      no claude → configurações → conectores → "add custom connector".
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className={STEP_BADGE}>3</span>
                    <div className="flex-1 min-w-0">
                      <p className="lowercase mb-2">
                        nome:{" "}
                        <code className="px-1.5 py-0.5 rounded bg-muted text-foreground font-mono text-xs">
                          bloquim
                        </code>{" "}
                        · url:
                      </p>
                      <CopyableField value={mcpEndpoint} />
                    </div>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className={STEP_BADGE}>4</span>
                    <span className="lowercase pt-0.5">
                      salvar → vincular → faça login e autorize. é a tela do bloquim — sua senha
                      não é compartilhada com o cliente de ia.
                    </span>
                  </li>
                </ol>

                <div className="mt-5 flex items-start gap-2 p-4 rounded-xl bg-emerald-500/10 text-sm">
                  <Check className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600" />
                  <p className="lowercase">
                    <strong className="font-medium">confirme que funcionou:</strong> peça ao
                    claude <em>"lista meus workspaces"</em> — ou rode{" "}
                    <code className="px-1.5 py-0.5 rounded bg-muted text-foreground font-mono text-xs">
                      /tutorial
                    </code>{" "}
                    para um tour rápido.
                  </p>
                </div>

                {/* Sub-collapsible — outros clientes */}
                <Collapsible className="mt-4 rounded-2xl border border-border/50 overflow-hidden">
                  <CollapsibleTrigger className="group/sub w-full px-4 py-3 flex items-center gap-2 text-left hover:bg-accent/20 transition-colors">
                    <ChevronDown className="w-4 h-4 text-muted-foreground transition-transform group-data-[state=open]/sub:rotate-180" />
                    <span className="text-sm lowercase text-muted-foreground">
                      outros clientes (cursor, claude code cli…)
                    </span>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="overflow-hidden">
                    <div className="px-4 pb-4 pt-1 text-sm text-muted-foreground lowercase">
                      qualquer cliente compatível com mcp usa a mesma url + oauth; só o caminho até
                      "add custom connector" muda conforme o app.
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Bloco 3 — Comece por aqui */}
          <div className="rounded-3xl border border-border/60 overflow-hidden mb-6">
            <div className="p-6 flex items-center gap-3 border-b border-border/50">
              <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
                <Sparkles className="w-5 h-5 text-primary" />
              </div>
              <h2 className="text-lg font-display font-medium tracking-tight lowercase">
                comece por aqui
              </h2>
            </div>
            <div className="p-6 space-y-2">
              <TriggerCard text="/revisao_minhas_tarefas" hint="ritual de revisão das suas pendências" />
              <TriggerCard
                text="preciso revisar os criativos amanhã"
                hint="solte um compromisso; o claude oferece registrar (captura proativa)"
              />
              <TriggerCard
                text="/extrair_tarefas_de_reuniao"
                hint="depois cole a ata; vira uma lista de tarefas"
              />
              <p className="text-sm text-muted-foreground/80 lowercase flex items-center gap-1.5 pt-1">
                <Wand2 className="w-3.5 h-3.5" />
                fale natural — não precisa decorar comando.
              </p>
            </div>
          </div>

          {/* Bloco 4 — Callout captura proativa */}
          <div className="rounded-3xl border border-border/60 bg-accent/10 p-6 mb-6 flex items-start gap-3">
            <MessageSquareText className="w-5 h-5 text-primary shrink-0 mt-0.5" />
            <p className="text-sm text-muted-foreground lowercase">
              <strong className="font-medium text-foreground">captura proativa:</strong> solte um
              compromisso no meio da conversa ("preciso ligar pro contador dia 25") e o claude
              oferece registrar no bloquim — você só confirma. nada é criado sem o seu ok.
            </p>
          </div>

          {/* Bloco 5 — CTA skill (proeminente) */}
          <div className="rounded-3xl border-2 border-primary/30 bg-primary/5 p-6 mb-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-2xl bg-primary/15 flex items-center justify-center shrink-0">
                <Rocket className="w-5 h-5 text-primary" />
              </div>
              <h2 className="text-lg font-display font-medium tracking-tight lowercase">
                turbine o agente (claude code)
              </h2>
            </div>
            <p className="text-sm text-muted-foreground lowercase mb-4">
              instale a skill <code className="px-1.5 py-0.5 rounded bg-muted text-foreground font-mono text-xs">bloquim</code>{" "}
              e o agente passa a dominar todos os fluxos (planos, delegação, anexos, busca).
            </p>
            <CopyableField value={SKILL_INSTALL_CMD} />
            <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
              <span className="text-xs text-muted-foreground/70 lowercase">
                o mcp sozinho já funciona — a skill é o turbo, recomendada para claude code / api.
              </span>
              <Button asChild variant="outline" size="sm" className="rounded-xl shrink-0">
                <a href={SKILL_REPO_URL} target="_blank" rel="noreferrer noopener">
                  <Github className="w-4 h-4 mr-2" />
                  <span className="lowercase">Abrir no github</span>
                </a>
              </Button>
            </div>
          </div>

          {/* Bloco 6 — Se der errado */}
          <Collapsible className="rounded-3xl border border-border/60 overflow-hidden mb-6">
            <CollapsibleTrigger className="group/err w-full p-6 flex items-center gap-4 text-left hover:bg-accent/20 transition-colors">
              <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center shrink-0">
                <CircleHelp className="w-6 h-6 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-display font-medium tracking-tight lowercase">
                  se der errado
                </h2>
              </div>
              <ChevronDown className="w-5 h-5 text-muted-foreground transition-transform group-data-[state=open]/err:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent className="overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0">
              <div className="p-6 border-t border-border/50 space-y-3 text-sm text-muted-foreground">
                <p className="lowercase">
                  <strong className="font-medium text-foreground">o conector não aparece depois de salvar:</strong>{" "}
                  recarregue o cliente / reabra a tela de conectores.
                </p>
                <p className="lowercase">
                  <strong className="font-medium text-foreground">falhou no login ou no "autorizar":</strong>{" "}
                  confirme que está logado no bloquim no mesmo navegador e tente vincular de novo.
                </p>
                <p className="lowercase">
                  <strong className="font-medium text-foreground">as descrições das ferramentas parecem desatualizadas:</strong>{" "}
                  remova e adicione o conector de novo (re-vincular) para limpar o cache do cliente.
                  não afeta seus dados.
                </p>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Bloco 7 — Ferramentas (collapsible fechado, no fim) */}
          <Collapsible className="rounded-3xl border border-border/60 overflow-hidden">
            <CollapsibleTrigger className="group/tools w-full p-6 flex items-center gap-4 text-left hover:bg-accent/20 transition-colors">
              <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center shrink-0">
                <Plug className="w-6 h-6 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-display font-medium tracking-tight lowercase">
                  {loading || error
                    ? "ferramentas disponíveis"
                    : `${totalTools} ${totalTools === 1 ? "ferramenta disponível" : "ferramentas disponíveis"}`}
                </h2>
              </div>
              <ChevronDown className="w-5 h-5 text-muted-foreground transition-transform group-data-[state=open]/tools:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent className="overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0">
              <div className="p-6 border-t border-border/50">
                <div className="flex justify-end mb-4">
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
                        Não foi possível buscar a lista de ferramentas. tente recarregar.
                      </p>
                    </div>
                    <Button onClick={fetchTools} variant="outline" className="rounded-xl">
                      <RefreshCw className="w-4 h-4 mr-2" />
                      <span className="lowercase">Tentar novamente</span>
                    </Button>
                  </div>
                ) : grouped.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic lowercase">
                    Nenhuma ferramenta exposta.
                  </p>
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
                            <div key={tool.name} className="p-4 rounded-xl border bg-background">
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
            </CollapsibleContent>
          </Collapsible>

          {/* Bloco 8 — Rodapé OAuth */}
          <p className="text-xs text-muted-foreground/70 mt-4 px-2 lowercase flex items-center gap-1">
            <ShieldCheck className="w-3 h-3" />
            <span>
              O acesso é autorizado via oauth. seus dados de login não saem do bloquim — o cliente
              de ia recebe só um token de acesso.
            </span>
          </p>
        </div>
      </div>
    </AppLayout>
  );
}
