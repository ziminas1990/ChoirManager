import { TaskData } from "@src/entities/task.js";
import { Expected } from "@src/utils/expected.js";

export interface ITaskTracker {
    fetch_all(): Promise<Expected<TaskData[]>>;
}
