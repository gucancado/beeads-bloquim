export interface TaskGroup<T> {
  today: T[];
  untilFriday: T[];
  nextWeek: T[];
  upcoming: T[];
  noDueDate: T[];
}

export type TimeWindow =
  | "hoje"
  | "ate_sexta"
  | "proxima_semana"
  | "sem_prazo"
  | "todas";

export function groupTasksByDeadline<
  T extends { dueDate?: string | null; scheduleMode?: string | null }
>(tasks: T[], now: Date = new Date()): TaskGroup<T> {
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  const dayOfWeek = now.getDay();
  const isFriday = dayOfWeek === 5;

  // (5 - dayOfWeek + 7) % 7 dá 0 na sexta, 1 na quinta, etc.
  // Aos sábados e domingos isso aponta pra sexta da semana seguinte —
  // intencional, segue a expectativa do usuário em fim de semana.
  const daysUntilFriday = isFriday ? 0 : (5 - dayOfWeek + 7) % 7;
  const fridayEnd = new Date(now);
  fridayEnd.setDate(now.getDate() + daysUntilFriday);
  fridayEnd.setHours(23, 59, 59, 999);

  // "Próxima semana" = janela móvel de 7 dias a partir do dia seguinte à
  // sexta-feira relevante. Em dias úteis isso vira sáb→sex; em fim de semana
  // estende além da sexta da semana seguinte.
  const nextWeekEnd = new Date(fridayEnd);
  nextWeekEnd.setDate(fridayEnd.getDate() + 7);

  // Tarefas urgentes não têm prazo, mas devem aparecer no topo do grupo
  // "hoje" — não fazem sentido em "sem prazo" porque a modalidade significa
  // "fazer agora". Coletadas separadamente e prependadas ao `today`.
  const urgent: T[] = [];
  const today: T[] = [];
  const untilFriday: T[] = [];
  const nextWeek: T[] = [];
  const upcoming: T[] = [];
  const noDueDate: T[] = [];

  for (const task of tasks) {
    if (task.scheduleMode === "urgente") {
      urgent.push(task);
      continue;
    }
    if (!task.dueDate) {
      noDueDate.push(task);
      continue;
    }

    const due = new Date(task.dueDate);

    if (due <= todayEnd) {
      today.push(task);
    } else if (!isFriday && due <= fridayEnd) {
      untilFriday.push(task);
    } else if (due <= nextWeekEnd) {
      nextWeek.push(task);
    } else {
      upcoming.push(task);
    }
  }

  return {
    today: [...urgent, ...today],
    untilFriday,
    nextWeek,
    upcoming,
    noDueDate,
  };
}

/**
 * Label dinâmico do botão "até sexta":
 *   - seg/ter/qua/sáb/dom → "até sexta"
 *   - quinta → "amanhã"
 *   - sexta → null (botão fica oculto)
 */
export function ateSextaLabel(now: Date = new Date()): "até sexta" | "amanhã" | null {
  const day = now.getDay();
  if (day === 5) return null;
  if (day === 4) return "amanhã";
  return "até sexta";
}

/**
 * Extrai um subset do agrupamento conforme a janela selecionada.
 * - "hoje"          → grupo today (que já inclui urgentes no topo)
 * - "ate_sexta"     → today + untilFriday (janela cumulativa — vê hoje
 *                     também, com urgentes no topo)
 * - "proxima_semana"→ grupo nextWeek
 * - "sem_prazo"     → noDueDate (urgentes ficam fora porque já vão pra "hoje")
 * - "todas"         → união (chamador deve usar agrupamento completo)
 */
export function selectWindow<T>(
  grouped: TaskGroup<T>,
  window: Exclude<TimeWindow, "todas">,
): T[] {
  switch (window) {
    case "hoje":
      return grouped.today;
    case "ate_sexta":
      return [...grouped.today, ...grouped.untilFriday];
    case "proxima_semana":
      return grouped.nextWeek;
    case "sem_prazo":
      return grouped.noDueDate;
  }
}

