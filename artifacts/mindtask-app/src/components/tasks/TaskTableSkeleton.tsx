import { Skeleton } from "@beeads/ui";

export function TaskTableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Carregando tarefas" className="w-full">
      <div className="flex items-center gap-4 px-3 py-2 mb-1">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-24 ml-auto" />
      </div>
      <ul className="flex flex-col gap-1">
        {Array.from({ length: rows }).map((_, i) => (
          <li
            key={i}
            className="flex items-center gap-3 px-3 py-3 rounded-lg bg-card/40"
          >
            <Skeleton className="h-5 w-5 rounded-full shrink-0" />
            <Skeleton className="h-4 flex-1 max-w-[60%]" />
            <Skeleton className="h-4 w-20 hidden md:block" />
            <Skeleton className="h-6 w-6 rounded-full shrink-0" />
            <Skeleton className="h-4 w-16" />
          </li>
        ))}
      </ul>
    </div>
  );
}
