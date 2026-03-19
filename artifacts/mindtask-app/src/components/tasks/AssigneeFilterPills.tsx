interface Member {
  userId: string;
  name: string;
}

interface AssigneeFilterPillsProps {
  members: Member[];
  selected: string[];
  onToggle: (id: string) => void;
  meLabel?: string;
  showMe?: boolean;
}

export function AssigneeFilterPills({
  members,
  selected,
  onToggle,
  meLabel = "Eu",
  showMe = false,
}: AssigneeFilterPillsProps) {
  const pills: { id: string; label: string; activeClass: string }[] = [];

  if (showMe) {
    pills.push({
      id: "me",
      label: meLabel,
      activeClass: "bg-violet-500 text-white border-violet-500 hover:bg-violet-600",
    });
  }

  members.forEach(m => {
    pills.push({
      id: m.userId,
      label: m.name,
      activeClass: "bg-indigo-500 text-white border-indigo-500 hover:bg-indigo-600",
    });
  });

  pills.push({
    id: "unassigned",
    label: "Sem responsável",
    activeClass: "bg-slate-500 text-white border-slate-500 hover:bg-slate-600",
  });

  return (
    <>
      {pills.map(pill => {
        const isActive = selected.includes(pill.id);
        return (
          <button
            key={pill.id}
            onClick={() => onToggle(pill.id)}
            className={`px-4 py-1.5 rounded-full text-sm font-semibold border transition-all duration-150 cursor-pointer ${
              isActive
                ? pill.activeClass
                : "bg-card text-muted-foreground border-border hover:border-slate-400 dark:hover:border-slate-600"
            }`}
          >
            {pill.label}
          </button>
        );
      })}
    </>
  );
}
