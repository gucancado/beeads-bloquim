import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Avatar, AvatarFallback, AvatarImage } from "@beeads/ui";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { User } from "lucide-react";
import type { WorkspaceMemberResponse } from "@workspace/api-client-react";
import { MemberSelectList, type MemberItem } from "@/components/tasks/MemberSelectList";

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0].toUpperCase())
    .join("");
}

interface AssigneeAvatarPickerProps {
  assignedTo: string;
  members: WorkspaceMemberResponse[] | undefined;
  onSelect: (value: string) => void;
}

export function AssigneeAvatarPicker({
  assignedTo,
  members,
  onSelect,
}: AssigneeAvatarPickerProps) {
  const [open, setOpen] = useState(false);
  const selectedMember = members?.find(m => m.userId === assignedTo) ?? null;
  const assigneeName = selectedMember?.user.name ?? null;
  const assigneeAvatarUrl = selectedMember?.user.avatarUrl ?? null;

  const memberItems: MemberItem[] = (members ?? []).map(m => ({
    userId: m.userId,
    name: m.user.name,
    avatarUrl: m.user.avatarUrl ?? null,
  }));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex items-center justify-center w-10 h-10 rounded-xl bg-background hover:bg-muted/60 transition-colors focus:outline-none cursor-pointer"
              >
                {assigneeName ? (
                  <Avatar key={`${assignedTo}|${assigneeAvatarUrl ?? ""}`} className="w-9 h-9 shrink-0">
                    {assigneeAvatarUrl ? (
                      <AvatarImage src={assigneeAvatarUrl} alt={assigneeName} className="object-cover" />
                    ) : null}
                    <AvatarFallback className="text-xs font-semibold bg-primary/10 text-primary">
                      {getInitials(assigneeName)}
                    </AvatarFallback>
                  </Avatar>
                ) : (
                  <User className="w-5 h-5 text-muted-foreground shrink-0" />
                )}
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>
            {assigneeName ?? "Sem responsável"}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent
        align="start"
        className="w-auto p-1 rounded-xl min-w-[180px]"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <MemberSelectList
          members={memberItems}
          selectedId={assignedTo && assignedTo !== "unassigned" ? assignedTo : null}
          onSelect={(id) => {
            onSelect(id ?? "unassigned");
            setOpen(false);
          }}
          unassignedLabel="Sem responsável"
        />
      </PopoverContent>
    </Popover>
  );
}
