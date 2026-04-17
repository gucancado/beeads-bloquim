import { ChevronDown, Briefcase, LayoutDashboard } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function TaskAssociationSelector({
  showMore,
  onExpand,
  effectiveWorkspaceId,
  taskMapId,
  propWorkspaceId,
  userWorkspaces,
  workspaceMaps,
  onWorkspaceChange,
  onMapChange,
}: {
  showMore: boolean;
  onExpand: () => void;
  effectiveWorkspaceId: string;
  taskMapId: string | null;
  propWorkspaceId: string | undefined;
  userWorkspaces: { id: string; name: string }[] | undefined;
  workspaceMaps: { id: string; name: string; hidden: boolean }[] | undefined;
  onWorkspaceChange: (newWsId: string | null) => void;
  onMapChange: (newMapId: string | null) => void;
}) {
  return (
    <div>
      {!showMore && (
        <button
          type="button"
          onClick={onExpand}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-1 py-0.5 rounded lowercase"
        >
          <ChevronDown className="w-3 h-3" />
          mais
        </button>
      )}
      {showMore && (
        <div className="mt-2 grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-muted-foreground tracking-wider mb-1.5 flex items-center gap-1 block lowercase">
              <Briefcase className="w-3 h-3" /> Espaço de trabalho
            </label>
            <Select
              value={effectiveWorkspaceId || "none"}
              onValueChange={v => onWorkspaceChange(v === "none" ? null : v)}
              disabled={!!propWorkspaceId}
            >
              <SelectTrigger className="bg-background rounded-xl h-10">
                <SelectValue placeholder="Nenhum" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none"><span className="lowercase">Nenhum</span></SelectItem>
                {userWorkspaces?.map((ws) => (
                  <SelectItem key={ws.id} value={ws.id}>{ws.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground tracking-wider mb-1.5 flex items-center gap-1 block lowercase">
              <LayoutDashboard className="w-3 h-3" /> Plano
            </label>
            <Select
              value={taskMapId || "none"}
              onValueChange={v => onMapChange(v === "none" ? null : v)}
              disabled={!effectiveWorkspaceId}
            >
              <SelectTrigger className="bg-background rounded-xl h-10">
                <SelectValue placeholder="Nenhum" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none"><span className="lowercase">Nenhum</span></SelectItem>
                {workspaceMaps?.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </div>
  );
}
