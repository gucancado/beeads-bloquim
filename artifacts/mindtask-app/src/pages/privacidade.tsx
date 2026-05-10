import { Link } from "wouter";
import { NotebookPen } from "lucide-react";
import { ThemeToggleFloat } from "@/components/layout/ThemeToggleFloat";

export default function PrivacidadePage() {
  return (
    <div className="min-h-screen w-full bg-background">
      <ThemeToggleFloat />
      <div className="max-w-3xl mx-auto px-6 py-12 lg:py-16">
        <Link href="/" className="inline-flex items-center gap-2 mb-10 text-sm text-muted-foreground hover:text-foreground">
          <NotebookPen className="w-5 h-5" />
          <span className="font-display font-semibold">Bloquim</span>
        </Link>

        <h1 className="text-3xl font-display font-bold mb-2">Política de Privacidade</h1>
        <p className="text-sm text-muted-foreground mb-10">Última atualização: 10 de maio de 2026.</p>

        <div className="prose prose-slate dark:prose-invert max-w-none space-y-6 text-sm leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold mt-8 mb-3">1. Quem somos</h2>
            <p>
              Bloquim é uma plataforma de planejamento e gestão de tarefas baseada em mapas mentais, operada por
              Gustavo Azevedo (contato: <a className="underline" href="mailto:gustavo.azvd@gmail.com">gustavo.azvd@gmail.com</a>).
              Esta política descreve como coletamos, usamos, armazenamos e protegemos seus dados ao utilizar o Bloquim
              em <a className="underline" href="https://bloquim.beeads.com.br">https://bloquim.beeads.com.br</a>.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mt-8 mb-3">2. Dados que coletamos</h2>
            <p>Ao criar uma conta e usar o Bloquim, coletamos:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>Dados de cadastro:</strong> nome, e-mail e senha (armazenada com hash bcrypt).</li>
              <li><strong>Conteúdo produzido por você:</strong> workspaces, mapas mentais, cards, tarefas, comentários, anexos e templates.</li>
              <li><strong>Dados de uso:</strong> registros técnicos de requisições (data, rota, status), exclusivamente para operação e diagnóstico.</li>
              <li><strong>Cookies essenciais:</strong> um cookie HttpOnly chamado <code>token</code> para autenticação JWT, com duração de 7 dias.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mt-8 mb-3">3. Integração com o Google Agenda</h2>
            <p>
              Caso você opte por conectar sua conta Google em <em>Configurações → Integrações</em>, o Bloquim solicita
              o escopo <code>https://www.googleapis.com/auth/calendar.readonly</code>. Isso significa:
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>O acesso é exclusivamente de <strong>leitura</strong>. O Bloquim nunca cria, altera ou apaga eventos no seu Google Agenda.</li>
              <li>Usamos os dados unicamente para exibir, dentro do Bloquim, a lista de eventos do dia das agendas que você habilitar.</li>
              <li>Os <em>access tokens</em> e <em>refresh tokens</em> emitidos pelo Google são armazenados criptografados em nosso banco de dados (AES-GCM com chave dedicada).</li>
              <li>Os tokens nunca são compartilhados com terceiros, vendidos, usados para treinar modelos de IA ou aplicados a qualquer finalidade fora do exibido em "minhas tarefas".</li>
              <li>Você pode desconectar a qualquer momento em <em>Configurações → Integrações → Desconectar</em>. Ao desconectar, o Bloquim revoga o token no Google e apaga as credenciais e preferências de calendário associadas à sua conta.</li>
              <li>O uso e a transferência das informações recebidas pelo Bloquim a partir das APIs do Google obedecem à{" "}
                <a className="underline" target="_blank" rel="noopener" href="https://developers.google.com/terms/api-services-user-data-policy">
                  Política de Dados do Usuário dos Serviços de API do Google
                </a>, incluindo os requisitos de Uso Limitado.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mt-8 mb-3">4. Como usamos seus dados</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>Para fornecer e operar as funcionalidades do produto (autenticação, persistência de mapas, tarefas, comentários, anexos, busca).</li>
              <li>Para personalizar a experiência (lista de mapas recentes, preferências de calendário, ordenação da sidebar).</li>
              <li>Para diagnosticar problemas e melhorar a estabilidade do serviço.</li>
            </ul>
            <p>Não usamos seus dados para publicidade, segmentação, vendas a terceiros ou treinamento de modelos de IA.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mt-8 mb-3">5. Armazenamento e segurança</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>Banco de dados PostgreSQL gerenciado (Supabase), com conexões TLS.</li>
              <li>Arquivos anexados em armazenamento S3-compatível (Cloudflare R2), acessados via URLs assinadas.</li>
              <li>Servidores em provedor de nuvem com backups automáticos diários.</li>
              <li>Senhas armazenadas com hash bcrypt; tokens de integração criptografados em repouso.</li>
              <li>Tráfego protegido por HTTPS/TLS.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mt-8 mb-3">6. Compartilhamento de dados</h2>
            <p>
              Não vendemos, alugamos nem compartilhamos seus dados pessoais com terceiros para fins comerciais.
              Recorremos a sub-processadores estritamente operacionais (hospedagem, banco e armazenamento), que tratam
              os dados sob nossas instruções e mediante acordos compatíveis com esta política.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mt-8 mb-3">7. Seus direitos</h2>
            <p>Conforme a LGPD (Lei nº 13.709/2018), você pode a qualquer momento:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Confirmar a existência de tratamento e acessar seus dados.</li>
              <li>Corrigir dados incompletos, inexatos ou desatualizados.</li>
              <li>Solicitar a anonimização, bloqueio ou eliminação de dados desnecessários ou excessivos.</li>
              <li>Solicitar a portabilidade ou a exclusão da conta e de todo o seu conteúdo.</li>
              <li>Revogar consentimentos previamente fornecidos (incluindo a integração com o Google).</li>
            </ul>
            <p>Para exercer qualquer desses direitos, envie um e-mail para <a className="underline" href="mailto:gustavo.azvd@gmail.com">gustavo.azvd@gmail.com</a>.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mt-8 mb-3">8. Retenção</h2>
            <p>
              Mantemos seus dados enquanto sua conta estiver ativa. Ao solicitar exclusão, removemos seu conteúdo
              dentro de até 30 dias, salvo obrigações legais de retenção. Logs técnicos não-identificáveis podem ser
              mantidos por até 90 dias para fins de auditoria.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mt-8 mb-3">9. Alterações nesta política</h2>
            <p>
              Podemos atualizar esta política para refletir mudanças no produto ou na legislação. Mudanças relevantes
              serão sinalizadas dentro do app ou por e-mail. A data de "última atualização" no topo desta página
              indica a versão vigente.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mt-8 mb-3">10. Contato</h2>
            <p>
              Dúvidas, solicitações da LGPD ou denúncias podem ser enviadas para{" "}
              <a className="underline" href="mailto:gustavo.azvd@gmail.com">gustavo.azvd@gmail.com</a>.
            </p>
          </section>
        </div>

        <div className="mt-12 pt-6 border-t border-border/60 flex items-center justify-between text-xs text-muted-foreground">
          <Link href="/" className="hover:text-foreground">← voltar ao início</Link>
          <Link href="/termos" className="hover:text-foreground">termos de serviço →</Link>
        </div>
      </div>
    </div>
  );
}
