export interface TaskGroup<T> {
  today: T[];
  untilFriday: T[];
  upcoming: T[];
  noDueDate: T[];
}

export function groupTasksByDeadline<T extends { dueDate?: string | null }>(
  tasks: T[],
  now: Date = new Date()
): TaskGroup<T> {
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  const dayOfWeek = now.getDay();
  const isFriday = dayOfWeek === 5;

  const daysUntilFriday = isFriday ? 0 : (5 - dayOfWeek + 7) % 7;
  const fridayEnd = new Date(now);
  fridayEnd.setDate(now.getDate() + daysUntilFriday);
  fridayEnd.setHours(23, 59, 59, 999);

  const today: T[] = [];
  const untilFriday: T[] = [];
  const upcoming: T[] = [];
  const noDueDate: T[] = [];

  for (const task of tasks) {
    if (!task.dueDate) {
      noDueDate.push(task);
      continue;
    }

    const due = new Date(task.dueDate);

    if (due <= todayEnd) {
      today.push(task);
    } else if (!isFriday && due <= fridayEnd) {
      untilFriday.push(task);
    } else {
      upcoming.push(task);
    }
  }

  return { today, untilFriday, upcoming, noDueDate };
}
