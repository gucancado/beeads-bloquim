import { Map as MapIcon, Plus } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@beeads/ui";
import { getColorByIndex } from "@workspace/db/colorPalette";

export interface WorkspaceChipOption {
  id: string;
  name: string;
  colorIndex?: number | null;
}

export interface MapChipOption {
  id: string;
  name: string;
  hidden: boolean;
}

const chipClass =
  "h-auto w-auto min-w-0 border-0 shadow-none bg-transparent hover:bg-muted/60 dark:hover:bg-muted/30 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring [&>svg]:hidden [&>span]:flex [&>span]:items-center justify-start whitespace-nowrap disabled:opacity-100 disabled:cursor-default";

export function TaskAssociationChips({
  effectiveWorkspaceId,
  taskMapId,
  propWorkspaceId,
  userWorkspaces,
  workspaceMaps,
  onWorkspaceChange,
  onMapChange,
  mapDisabled = false,
}: {
  effectiveWorkspaceId: string;
  taskMapId: string | null;
  propWorkspaceId: string | undefined;
  userWorkspaces: WorkspaceChipOption[] | undefined;
  workspaceMaps: MapChipOption[] | undefined;
  onWorkspaceChange: (newWsId: string | null) => void;
  onMapChange: (newMapId: string | null) => void;
  mapDisabled?: boolean;
}) {
  const currentWorkspace = userWorkspaces?.find((w) => w.id === effectiveWorkspaceId) ?? null;
  const currentMap = workspaceMaps?.find((m) => m.id === (taskMapId ?? "")) ?? null;
  const hasWorkspace = !!effectiveWorkspaceId;
  const wsColor = getColorByIndex(currentWorkspace?.colorIndex ?? null);
  const wsDisabled = !!propWorkspaceId;

  return (
    <div className="flex items-center gap-1 min-w-0 flex-wrap">
      <Select
        value={effectiveWorkspaceId || "none"}
        onValueChange={(v) => onWorkspaceChange(v === "none" ? null : v)}
        disabled={wsDisabled}
      >
        <SelectTrigger className={chipClass} aria-label="alterar espaço de trabalho">
          {hasWorkspace ? (
            <span className="inline-flex items-center gap-2 min-w-0">
              {wsColor ? (
                <span
                  style={{ backgroundColor: wsColor, width: 8, height: 8, minWidth: 8 }}
                  className="rounded-sm shrink-0 inline-block"
                />
              ) : (
                <span className="w-2 h-2 rounded-sm bg-muted-foreground/40 shrink-0 inline-block" />
              )}
              <span className="truncate max-w-[160px]">
                {currentWorkspace?.name ?? "espaço"}
              </span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <Plus className="w-3 h-3 shrink-0" />
              <span className="lowercase">espaço de trabalho</span>
            </span>
          )}
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">
            <span className="lowercase">Nenhum</span>
          </SelectItem>
          {userWorkspaces?.map((ws) => (
            <SelectItem key={ws.id} value={ws.id}>
              {ws.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {hasWorkspace && (
        <Select
          value={taskMapId || "none"}
          onValueChange={(v) => onMapChange(v === "none" ? null : v)}
          disabled={mapDisabled}
        >
          <SelectTrigger className={chipClass} aria-label="alterar plano">
            {currentMap ? (
              <span className="inline-flex items-center gap-1.5 min-w-0">
                <MapIcon className="w-3 h-3 shrink-0" />
                <span className="truncate max-w-[200px]">{currentMap.name}</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <MapIcon className="w-3 h-3 shrink-0" />
                <span className="lowercase">plano +</span>
              </span>
            )}
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">
              <span className="lowercase">Nenhum</span>
            </SelectItem>
            {workspaceMaps?.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
