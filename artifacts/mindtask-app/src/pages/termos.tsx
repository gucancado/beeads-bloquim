import { Link } from "wouter";
import { NotebookPen } from "lucide-react";
import { ThemeToggleFloat } from "@/components/layout/ThemeToggleFloat";

export default function TermosPage() {
  return (
    <div className="min-h-screen w-full bg-background">
      <ThemeToggleFloat />
      <div className="max-w-3xl mx-auto px-6 py-12 lg:py-16">
        <Link href="/" className="inline-flex items-center gap-2 mb-10 text-sm text-muted-foreground hover:text-foreground">
          <NotebookPen className="w-5 h-5" />
          <span className="font-display font-semibold">Bloquim</span>
        </Link>

        <h1 className="text-3xl font-display font-bold mb-2">Termos de Serviço</h1>
        <p className="text-sm text-muted-foreground mb-10">Última atualização: 10 de maio de 2026.</p>

        <div className="prose prose-slate dark:prose-invert max-w-none space-y-6 text-sm leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold mt-8 mb-3">1. Aceitação</h2>
            <p>
              Ao acessar ou utilizar o Bloquim (<a className="underline" href="https://bloquim.beeads.com.br">https://bloquim.beeads.com.br</a>),
              você concorda integralmente com estes Termos de Serviço e com nossa{" "}
              <Link href="/privacidade" className="underline">Política de Privacidade</Link>.
              Caso não concorde, não utilize o serviço.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mt-8 mb-3">2. Descrição do serviço</h2>
            <p>
              O Bloquim é uma plataforma web para planejamento e gestão de tarefas baseada em mapas mentais.
              Permite criar workspaces, mapas, cards, tarefas, subtarefas, comentários, anexos, templates,
              aprovações sequenciais ou paralelas, e integrar visualização de eventos do Google Agenda em
              modo somente leitura.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mt-8 mb-3">3. Conta de usuário</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>Você é responsável por manter a confidencialidade de suas credenciais.</li>
              <li>Deve fornecer informações verdadeiras e atualizadas durante o cadastro.</li>
              <li>É vedado o uso de contas para terceiros sem o consentimento expresso destes.</li>
              <li>Notifique-nos imediatamente em caso de uso não autorizado da sua conta.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mt-8 mb-3">4. Uso aceitável</h2>
            <p>Você concorda em não utilizar o Bloquim para:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Atividades ilegais, fraudulentas, abusivas ou que violem direitos de terceiros.</li>
              <li>Distribuir malware, scripts maliciosos ou conteúdo ofensivo.</li>
              <li>Tentar acessar áreas restritas, contornar mecanismos de autenticação ou sobrecarregar a infraestrutura.</li>
              <li>Realizar engenharia reversa, raspagem em massa ou uso automatizado fora das interfaces oficiais.</li>
              <li>Carregar conteúdo protegido por direitos autorais sem autorização.</li>
            </ul>
            <p>O descumprimento pode resultar em suspensão ou exclusão da conta, sem aviso prévio.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mt-8 mb-3">5. Propriedade do conteúdo</h2>
            <p>
              Você mantém todos os direitos sobre o conteúdo que cria no Bloquim (mapas, tarefas, anexos, comentários).
              Você nos concede uma licença limitada, mundial e não-exclusiva para hospedar, processar e exibir esse
              conteúdo estritamente para fornecer o serviço.
            </p>
            <p>
              A marca, o código-fonte, o design e a interface do Bloquim permanecem de propriedade do operador.
              Nada nestes termos transfere direitos de propriedade intelectual sobre a plataforma.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mt-8 mb-3">6. Integração com o Google Agenda</h2>
            <p>
              Quando você conecta sua conta Google, o Bloquim solicita o escopo{" "}
              <code>https://www.googleapis.com/auth/calendar.readonly</code> e utiliza-o exclusivamente
              para exibir, dentro do app, a lista de eventos do dia das agendas que você habilitar.
              Os tokens emitidos pelo Google são armazenados criptografados e podem ser revogados a
              qualquer momento na tela de Integrações. Para detalhes, consulte nossa{" "}
              <Link href="/privacidade" className="underline">Política de Privacidade</Link>.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mt-8 mb-3">7. Disponibilidade e mudanças</h2>
            <p>
              Buscamos manter o Bloquim disponível continuamente, mas não garantimos operação ininterrupta.
              Podemos realizar manutenções, ajustes ou descontinuar funcionalidades a qualquer momento.
              Mudanças significativas serão comunicadas dentro do app ou por e-mail com antecedência razoável.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mt-8 mb-3">8. Encerramento</h2>
            <p>
              Você pode encerrar sua conta a qualquer momento, solicitando exclusão por e-mail. Podemos
              suspender ou encerrar contas que violem estes termos. Ao encerrar, seu conteúdo será removido
              dentro de até 30 dias, salvo obrigações legais de retenção.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mt-8 mb-3">9. Limitação de responsabilidade</h2>
            <p>
              O Bloquim é fornecido "como está" e "conforme disponível", sem garantias expressas ou implícitas
              de adequação a um propósito específico. Na máxima extensão permitida em lei, o operador não é
              responsável por danos indiretos, lucros cessantes, perda de dados ou interrupção de negócios
              decorrentes do uso ou da impossibilidade de uso do serviço.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mt-8 mb-3">10. Alterações destes termos</h2>
            <p>
              Podemos atualizar estes termos para refletir mudanças no produto, na legislação ou em práticas
              de negócio. A data de "última atualização" no topo desta página indica a versão vigente.
              O uso continuado do serviço após a publicação de termos atualizados constitui aceitação tácita
              das novas condições.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mt-8 mb-3">11. Lei aplicável e foro</h2>
            <p>
              Estes termos são regidos pelas leis da República Federativa do Brasil. Fica eleito o foro
              da comarca do domicílio do usuário para dirimir quaisquer controvérsias, sem prejuízo de outro
              competente conforme a legislação aplicável.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mt-8 mb-3">12. Contato</h2>
            <p>
              Dúvidas sobre estes termos podem ser enviadas para{" "}
              <a className="underline" href="mailto:gustavo.azvd@gmail.com">gustavo.azvd@gmail.com</a>.
            </p>
          </section>
        </div>

        <div className="mt-12 pt-6 border-t border-border/60 flex items-center justify-between text-xs text-muted-foreground">
          <Link href="/privacidade" className="hover:text-foreground">← política de privacidade</Link>
          <Link href="/" className="hover:text-foreground">voltar ao início →</Link>
        </div>
      </div>
    </div>
  );
}
