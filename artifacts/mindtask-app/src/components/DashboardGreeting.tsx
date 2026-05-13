import { useEffect, useState } from "react";
import {
  pickGreeting,
  deriveFirstName,
  type ResolvedGreeting,
} from "@/lib/greetings/greetings";

const LAST_VISIT_KEY = "bloquim_last_visit_at";
const SESSION_THRESHOLD_MS = 24 * 60 * 60 * 1000;

function readLastVisit(): number | undefined {
  try {
    const raw = localStorage.getItem(LAST_VISIT_KEY);
    if (!raw) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  } catch {
    return undefined;
  }
}

function writeLastVisit(now: number) {
  try {
    localStorage.setItem(LAST_VISIT_KEY, String(now));
  } catch {
    /* localStorage indisponível (modo privado, quota) — não bloqueia o render */
  }
}

interface DashboardGreetingProps {
  /** Nome completo (users.name). O componente deriva o primeiro nome. */
  name: string;
  /** ms da criação da conta. Usado pra `isFirstSession`. */
  createdAt: string | Date;
  /** Tarefas que vencem hoje (do /api/my-tasks/counts). */
  tasksDueToday: number;
  /** Tarefas atrasadas (do /api/my-tasks/counts). */
  overdueTasks: number;
  className?: string;
  /** Hook opcional pra telemetria — recebe a saudação resolvida uma vez. */
  onResolve?: (greeting: ResolvedGreeting) => void;
}

export function DashboardGreeting({
  name,
  createdAt,
  tasksDueToday,
  overdueTasks,
  className,
  onResolve,
}: DashboardGreetingProps) {
  // useState com inicializador → resolve UMA VEZ na montagem. Refetches do
  // React Query (counts mudando) não disparam novo sorteio.
  const [greeting] = useState<ResolvedGreeting>(() => {
    const firstName = deriveFirstName(name);
    const createdAtMs = new Date(createdAt).getTime();
    const isFirstSession =
      Number.isFinite(createdAtMs) && Date.now() - createdAtMs < SESSION_THRESHOLD_MS;

    return pickGreeting({
      firstName,
      tasksDueToday,
      overdueTasks,
      lastVisitAt: readLastVisit(),
      isFirstSession,
    });
  });

  // Persiste timestamp da visita atual pra próxima abertura.
  // Roda uma vez por montagem.
  useEffect(() => {
    writeLastVisit(Date.now());
  }, []);

  useEffect(() => {
    onResolve?.(greeting);
  }, [greeting, onResolve]);

  return (
    <h2
      className={className}
      data-greeting-layer={greeting.layer}
      data-greeting-rule={greeting.ruleId}
    >
      {greeting.text}
    </h2>
  );
}
