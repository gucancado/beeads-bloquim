import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { User } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MemberItem {
  userId: string;
  name: string;
  avatarUrl?: string | null;
}

interface Props {
  members: MemberItem[];
  selectedId: string | null;
  onSelect: (userId: string | null) => void;
  /** Default true — show the "sem responsável" option at the top. */
  showUnassigned?: boolean;
  unassignedLabel?: string;
  /** "compact" matches inline list dropdowns; "default" matches the modal picker. */
  density?: "default" | "compact";
}

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map(n => n[0].toUpperCase())
    .join("");
}

/**
 * Shared content of any member-selection popup. Replaces the duplicated lists
 * inside AssigneeAvatarPicker and TaskListItem's custom dropdown. Render this
 * inside a Radix Popover/DropdownMenu content panel.
 */
export function MemberSelectList({
  members,
  selectedId,
  onSelect,
  showUnassigned = true,
  unassignedLabel = "sem responsável",
  density = "default",
}: Props) {
  const isCompact = density === "compact";
  const itemClass = isCompact
    ? "w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/60 text-left transition-colors rounded-md"
    : "w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted/60 text-left transition-colors rounded-lg";
  const avatarSize = isCompact ? "w-5 h-5" : "w-6 h-6";
  const fallbackText = isCompact ? "text-[9px]" : "text-[10px]";

  return (
    <div className="flex flex-col">
      {showUnassigned && (
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={cn(itemClass, "text-muted-foreground")}
        >
          <User className={cn("shrink-0 text-muted-foreground", isCompact ? "w-3.5 h-3.5" : "w-4 h-4")} />
          <span className="lowercase">{unassignedLabel}</span>
        </button>
      )}
      {members.map(m => {
        const isSelected = selectedId === m.userId;
        return (
          <button
            key={m.userId}
            type="button"
            onClick={() => onSelect(m.userId)}
            className={cn(itemClass, isSelected && "font-semibold bg-muted/30")}
            aria-pressed={isSelected}
          >
            <Avatar className={cn(avatarSize, "shrink-0")}>
              {m.avatarUrl ? (
                <AvatarImage src={m.avatarUrl} alt={m.name} className="object-cover" />
              ) : null}
              <AvatarFallback className={cn(fallbackText, "font-semibold bg-primary/10 text-primary")}>
                {getInitials(m.name)}
              </AvatarFallback>
            </Avatar>
            <span className="text-foreground">{m.name}</span>
          </button>
        );
      })}
    </div>
  );
}
