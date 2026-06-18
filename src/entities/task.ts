export type TaskStatus = "pending" | "in_progress" | "completed" | "cancelled";

export type TaskData = {
    created_at: Date;  // Note: used as task id
    author_email: string;
    title: string;
    comment?: string;
    status: TaskStatus;
    deadline?: Date;
    manager?: string;
    assignee?: string;
}