import { NewTaskData, TaskData, TaskFilter, TaskUpdate } from "@src/entities/task.js";
import { Expected } from "@src/utils/expected.js";

export type TaskTrackerEvent = {
    what: "new_task",
    task: TaskData,
} | {
    what: "task_updated",
    update: TaskUpdate[],
} | {
    what: "task_deleted",
    task: TaskData,
} | {
    what: "deadline_notification",
    tasks: TaskData[],
}

// Service logic: caching, broadcasting, and deadline notifications.
export interface ITaskTrackerService {
    fetch(filter?: TaskFilter): Promise<Expected<TaskData[]>>;
    create(task: NewTaskData): Promise<Expected<TaskData>>;
    update(task: TaskData): Promise<Expected<TaskUpdate>>;
    delete(task: TaskData): Promise<Expected<TaskData>>;
}
