import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@beeads/ui";
import { Avatar, AvatarFallback, AvatarImage } from "@beeads/ui";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@beeads/ui";
import { Crown } from "lucide-react";
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

interface OwnerAvatarPickerProps {
  ownerId: string | null;
  members: WorkspaceMemberResponse[] | undefined;
  onSelect: (value: string) => void;
}

export function OwnerAvatarPicker({ ownerId, members, onSelect }: OwnerAvatarPickerProps) {
  const [open, setOpen] = useState(false);
  const selectedMember = members?.find(m => m.userId === ownerId) ?? null;
  const ownerName = selectedMember?.user.name ?? null;
  const ownerAvatarUrl = selectedMember?.user.avatarUrl ?? null;

  const memberItems: MemberItem[] = (members ?? []).map(m => ({
    userId: m.userId,
    name: m.user.name,
    avatarUrl: m.user.avatarUrl ?? null,
  }));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger render={(tooltipProps) => (
            <PopoverTrigger
              {...tooltipProps}
              render={(popoverProps) => (
                <button
                  {...popoverProps}
                  type="button"
                  className="flex items-center justify-center h-7 w-7 rounded-lg hover:bg-muted/60 transition-colors focus:outline-none cursor-pointer shrink-0"
                >
                  {ownerName ? (
                    <Avatar key={`${ownerId}|${ownerAvatarUrl ?? ""}`} className="w-6 h-6 shrink-0">
                      {ownerAvatarUrl ? (
                        <AvatarImage src={ownerAvatarUrl} alt={ownerName} className="object-cover" />
                      ) : null}
                      <AvatarFallback className="text-[10px] font-semibold bg-primary/10 text-primary">
                        {getInitials(ownerName)}
                      </AvatarFallback>
                    </Avatar>
                  ) : (
                    <Crown className="w-4 h-4 text-muted-foreground shrink-0" />
                  )}
                </button>
              )}
            />
          )} />
          <TooltipContent>
            {ownerName ? `Dono: ${ownerName}` : "Sem dono"}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent
        align="end"
        className="w-auto p-1 rounded-xl min-w-[180px]"
      >
        <MemberSelectList
          members={memberItems}
          selectedId={ownerId}
          onSelect={(id) => {
            if (id) onSelect(id);
            setOpen(false);
          }}
          showUnassigned={false}
        />
      </PopoverContent>
    </Popover>
  );
}
