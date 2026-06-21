export type TaskStatus = "pending" | "in_progress" | "completed" | "cancelled";

export type TaskFilter = {
    status?: TaskStatus[];
}

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

export function filter_tasks(tasks: TaskData[], filter?: TaskFilter): TaskData[] {
    if (filter?.status !== undefined && filter.status.length > 0) {
        const statuses = new Set(filter.status);
        return tasks.filter(task => statuses.has(task.status));
    }
    return tasks;
}