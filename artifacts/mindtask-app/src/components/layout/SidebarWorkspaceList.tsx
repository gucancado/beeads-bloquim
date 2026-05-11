import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { Loader2, ListTodo, GripVertical, ChevronLeft, ChevronDown } from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useState, useEffect } from "react";
import { getColorByIndex } from "@workspace/db/colorPalette";

interface SidebarMap {
  id: string;
  name: string;
}

interface SidebarWorkspace {
  id: string;
  name: string;
  colorIndex: number | null;
  createdAt: string;
  sortOrder: number | null;
  expanded: boolean;
  maps: SidebarMap[];
}

function WorkspaceColorDot({ colorIndex, size = 10 }: { colorIndex: number | null; size?: number }) {
  const hex = getColorByIndex(colorIndex);
  if (!hex) return null;
  return (
    <span
      style={{ backgroundColor: hex, width: size, height: size, minWidth: size }}
      className="rounded-sm shrink-0 inline-block"
    />
  );
}

function CollapsedWorkspaceItem({ workspace }: { workspace: SidebarWorkspace }) {
  const [location] = useLocation();
  const isWsActive = location.startsWith(`/workspaces/${workspace.id}`);

  return (
    <Link href={`/workspaces/${workspace.id}`}>
      <span
        title={workspace.name}
        className={`flex justify-center items-center py-2.5 rounded-xl transition-all duration-200 cursor-pointer ${
          isWsActive
            ? "bg-sidebar-accent text-primary"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
        }`}
      >
        {workspace.colorIndex ? (
          <WorkspaceColorDot colorIndex={workspace.colorIndex} size={12} />
        ) : (
          <ListTodo className="w-4 h-4" />
        )}
      </span>
    </Link>
  );
}

function SortableWorkspaceItem({
  workspace,
  onToggleExpanded,
}: {
  workspace: SidebarWorkspace;
  onToggleExpanded: (workspaceId: string, expanded: boolean) => void;
}) {
  const [location] = useLocation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: workspace.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const isWsActive = location.startsWith(`/workspaces/${workspace.id}`);
  const hasMaps = workspace.maps.length > 0;

  return (
    <div ref={setNodeRef} style={style} className="group/ws">
      <div className="flex items-center gap-1 px-3 py-2 rounded-xl hover:bg-sidebar-accent/30 transition-all duration-200">
        <button
          {...attributes}
          {...listeners}
          className="text-sidebar-foreground/20 hover:text-sidebar-foreground/50 cursor-grab active:cursor-grabbing shrink-0 touch-none opacity-0 group-hover/ws:opacity-100 transition-opacity"
          tabIndex={-1}
        >
          <GripVertical className="w-3.5 h-3.5" />
        </button>
        {workspace.colorIndex && <WorkspaceColorDot colorIndex={workspace.colorIndex} size={10} />}
        <Link href={`/workspaces/${workspace.id}`} className="flex-1 min-w-0">
          <span
            className={`flex items-center gap-2 text-sm font-medium truncate cursor-pointer transition-colors ${
              isWsActive
                ? "text-sidebar-accent-foreground"
                : "text-sidebar-foreground/80 hover:text-sidebar-foreground"
            }`}
          >
            <span className="truncate">{workspace.name}</span>
          </span>
        </Link>
        {hasMaps && (
          <button
            onClick={() => onToggleExpanded(workspace.id, !workspace.expanded)}
            className="shrink-0 w-6 h-6 mr-1 rounded-lg flex items-center justify-center text-sidebar-foreground/40 hover:text-sidebar-foreground hover:bg-sidebar-accent/60 transition-all"
            tabIndex={-1}
          >
            {workspace.expanded ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronLeft className="w-3.5 h-3.5" />
            )}
          </button>
        )}
      </div>

      {hasMaps && workspace.expanded && (
        <div className="ml-[38px] space-y-0.5 mb-1">
          {workspace.maps.map((map) => {
            const isMapActive = location === `/workspaces/${workspace.id}/maps/${map.id}`;
            return (
              <Link key={map.id} href={`/workspaces/${workspace.id}/maps/${map.id}`}>
                <span
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all duration-200 cursor-pointer text-xs ${
                    isMapActive
                      ? "bg-sidebar-accent text-primary font-medium"
                      : "text-sidebar-foreground/55 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground"
                  }`}
                >
                  <span className="truncate">{map.name}</span>
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface Props {
  collapsed: boolean;
  enabled: boolean;
}

export function SidebarWorkspaceList({ collapsed, enabled }: Props) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<SidebarWorkspace[]>({
    queryKey: ["/api/sidebar/workspaces"],
    queryFn: () => customFetch("/api/sidebar/workspaces"),
    enabled,
  });

  const [items, setItems] = useState<SidebarWorkspace[]>([]);

  useEffect(() => {
    if (data) {
      setItems(data);
    }
  }, [data]);

  const saveOrderMutation = useMutation({
    mutationFn: (workspaceIds: string[]) =>
      customFetch("/api/sidebar/order", {
        method: "PUT",
        body: JSON.stringify({ workspaceIds }),
      }),
  });

  const toggleExpandedMutation = useMutation({
    mutationFn: ({ workspaceId, expanded }: { workspaceId: string; expanded: boolean }) =>
      customFetch(`/api/sidebar/workspaces/${workspaceId}/expanded`, {
        method: "PATCH",
        body: JSON.stringify({ expanded }),
      }),
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sidebar/workspaces"] });
    },
  });

  const handleToggleExpanded = (workspaceId: string, expanded: boolean) => {
    setItems((prev) =>
      prev.map((ws) => (ws.id === workspaceId ? { ...ws, expanded } : ws))
    );
    toggleExpandedMutation.mutate({ workspaceId, expanded });
  };

  const sensors = useSensors(useSensor(PointerSensor));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setItems((prev) => {
        const oldIndex = prev.findIndex((ws) => ws.id === active.id);
        const newIndex = prev.findIndex((ws) => ws.id === over.id);
        const reordered = arrayMove(prev, oldIndex, newIndex);
        saveOrderMutation.mutate(reordered.map((ws) => ws.id));
        return reordered;
      });
    }
  };

  if (collapsed) {
    return (
      <div className="space-y-0.5">
        {items.map((ws) => (
          <CollapsedWorkspaceItem key={ws.id} workspace={ws} />
        ))}
      </div>
    );
  }

  return (
    <div>
      {isLoading ? (
        <div className="px-4 py-2 flex items-center gap-2 text-sidebar-foreground/40 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Carregando...</span>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={items.map((ws) => ws.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-0.5">
              {items.map((ws) => (
                <SortableWorkspaceItem
                  key={ws.id}
                  workspace={ws}
                  onToggleExpanded={handleToggleExpanded}
                />
              ))}
              {items.length === 0 && (
                <p className="px-3 text-sm text-sidebar-foreground/40 italic lowercase">
                  Nenhum espaço de trabalho
                </p>
              )}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
