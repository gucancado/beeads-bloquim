import { UserX } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@beeads/ui";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@beeads/ui";

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0].toUpperCase())
    .join("");
}

interface Member {
  userId: string;
  name: string;
  avatarUrl?: string | null;
}

interface AssigneeFilterPillsProps {
  members: Member[];
  selected: string[];
  onToggle: (id: string) => void;
  meLabel?: string;
  meAvatarUrl?: string | null;
  showMe?: boolean;
}

export function AssigneeFilterPills({
  members,
  selected,
  onToggle,
  meLabel = "Eu",
  meAvatarUrl,
  showMe = false,
}: AssigneeFilterPillsProps) {
  const anySelected = selected.length > 0;

  const items: { id: string; label: string; avatarUrl?: string | null; isIcon?: boolean }[] = [];

  if (showMe) {
    items.push({ id: "me", label: meLabel, avatarUrl: meAvatarUrl });
  }

  members.forEach(m => {
    items.push({ id: m.userId, label: m.name, avatarUrl: m.avatarUrl });
  });

  items.push({ id: "unassigned", label: "Sem responsável", isIcon: true });

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex items-center justify-center gap-1.5 flex-wrap">
        {items.map(item => {
          const isActive = selected.includes(item.id);
          return (
            <Tooltip key={item.id}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onToggle(item.id)}
                  className={`transition-all duration-200 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    anySelected && !isActive ? "grayscale opacity-60 scale-100" : "scale-100"
                  } ${isActive ? "scale-110 ring-2 ring-primary ring-offset-2" : ""}`}
                >
                  <Avatar className="w-9 h-9 border-2 border-card cursor-pointer">
                    {item.isIcon ? (
                      <AvatarFallback className="bg-slate-100 dark:bg-slate-800">
                        <UserX className="w-4 h-4 text-muted-foreground" />
                      </AvatarFallback>
                    ) : (
                      <>
                        {item.avatarUrl ? (
                          <AvatarImage src={item.avatarUrl} alt={item.label} className="object-cover" />
                        ) : null}
                        <AvatarFallback className="text-[11px] font-semibold bg-primary/10 text-primary">
                          {getInitials(item.label)}
                        </AvatarFallback>
                      </>
                    )}
                  </Avatar>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="font-medium">{item.label}</p>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
