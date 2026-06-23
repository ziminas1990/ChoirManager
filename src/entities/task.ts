import assert from "assert";

export type TaskStatus = "pending" | "in_progress" | "completed" | "cancelled";

export type TaskFilter = {
    status?: TaskStatus[];
}

export type TaskData = {
    id: string;
    schema: number;
    created_at: Date;
    author: string;
    title: string;
    comment?: string;
    status: TaskStatus;
    deadline?: Date;
    manager?: string;
    assignee?: string;
}

export type TaskField = Exclude<keyof TaskData, "id" | "schema" | "created_at">;
export type NewTaskData = Omit<TaskData, "id" | "schema" | "created_at">;

export type TaskUpdate = {
    task_id: string,
    previous: TaskData,
    next: TaskData,
    updates: Partial<{
        [Field in TaskField]: {
            previous?: TaskData[Field],
            next?: TaskData[Field],
        };
    }>;
};

export function get_task_id(task: TaskData): string {
    return task.id;
}

export function create_task_update(previous: TaskData, next: TaskData): TaskUpdate {
    assert(previous.id === next.id, "task ids must be the same");

    const update: TaskUpdate = {
        task_id: next.id,
        previous,
        next,
        updates: {},
    };

    if (previous.author !== next.author) {
        update.updates.author = { previous: previous.author, next: next.author };
    }
    if (previous.title !== next.title) {
        update.updates.title = { previous: previous.title, next: next.title };
    }
    if (previous.comment !== next.comment) {
        update.updates.comment = { previous: previous.comment, next: next.comment };
    }
    if (previous.status !== next.status) {
        update.updates.status = { previous: previous.status, next: next.status };
    }
    if (previous.deadline?.getTime() !== next.deadline?.getTime()) {
        update.updates.deadline = { previous: previous.deadline, next: next.deadline };
    }
    if (previous.manager !== next.manager) {
        update.updates.manager = { previous: previous.manager, next: next.manager };
    }
    if (previous.assignee !== next.assignee) {
        update.updates.assignee = { previous: previous.assignee, next: next.assignee };
    }

    return update;
}

export function filter_tasks(tasks: TaskData[], filter?: TaskFilter): TaskData[] {
    if (filter?.status !== undefined && filter.status.length > 0) {
        const statuses = new Set(filter.status);
        return tasks.filter(task => statuses.has(task.status));
    }
    return tasks;
}
