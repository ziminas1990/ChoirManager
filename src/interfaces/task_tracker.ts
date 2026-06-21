import { TaskData, TaskFilter } from "@src/entities/task.js";
import { Expected } from "@src/utils/expected.js";

export interface ITaskTracker {
    fetch(filter?: TaskFilter): Promise<Expected<TaskData[]>>;
}
