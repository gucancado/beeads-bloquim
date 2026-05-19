import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import {
  DEFAULT_TASK_COLUMN_ORDER,
  TaskColumnKey,
  mergeTaskColumnOrder,
} from "@/lib/taskColumnConstants";

interface SavedColumnOrder {
  columnKey: string;
  sortOrder: number;
}

export function useTaskColumnOrder() {
  const { data } = useQuery<SavedColumnOrder[]>({
    queryKey: ["/api/preferences/task-columns"],
    queryFn: () => customFetch("/api/preferences/task-columns"),
  });

  const [order, setOrder] = useState<TaskColumnKey[]>(() => [...DEFAULT_TASK_COLUMN_ORDER]);

  useEffect(() => {
    if (data) {
      setOrder(mergeTaskColumnOrder(data));
    }
  }, [data]);

  const saveOrderMutation = useMutation({
    mutationFn: (columnKeys: TaskColumnKey[]) =>
      customFetch("/api/preferences/task-columns", {
        method: "PUT",
        body: JSON.stringify({ columnKeys }),
      }),
  });

  const reorder = (next: TaskColumnKey[]) => {
    setOrder(next);
    saveOrderMutation.mutate(next);
  };

  return { order, reorder };
}
