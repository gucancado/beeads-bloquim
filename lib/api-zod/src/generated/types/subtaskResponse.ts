export interface SubtaskResponse {
  id: string;
  taskId: string;
  text: string;
  completed: boolean;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}
