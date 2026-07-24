import { NewTaskData, TaskData, TaskUpdate } from "@src/entities/task.js";
import { Expected } from "@src/utils/expected.js";

// Pure persistence: no caching, no broadcasting, no notifications.
export interface ITaskTrackerStorage {
    create(task: NewTaskData): Promise<Expected<TaskData>>;
    update(task: TaskData): Promise<Expected<TaskUpdate>>;
    delete(task: TaskData): Promise<Expected<TaskData>>;
    fetch_all(): Promise<Expected<TaskData[]>>;
}
