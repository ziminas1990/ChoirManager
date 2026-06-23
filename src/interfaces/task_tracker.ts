import { NewTaskData, TaskData, TaskFilter, TaskUpdate } from "@src/entities/task.js";
import { Expected } from "@src/utils/expected.js";

export interface ITaskTracker {
    fetch(filter?: TaskFilter): Promise<Expected<TaskData[]>>;
    create(task: NewTaskData): Promise<Expected<TaskData>>;
    update(task: TaskData): Promise<Expected<TaskUpdate>>;
    delete(task: TaskData): Promise<Expected<TaskData>>;
}
