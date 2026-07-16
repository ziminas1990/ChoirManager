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

export interface ITaskTracker {
    fetch(filter?: TaskFilter): Promise<Expected<TaskData[]>>;
    create(task: NewTaskData): Promise<Expected<TaskData>>;
    update(task: TaskData): Promise<Expected<TaskUpdate>>;
    delete(task: TaskData): Promise<Expected<TaskData>>;
}


export class TaskTrackerInstance {

    private static instance?: ITaskTracker;

    static set_instance(instance: ITaskTracker): void {
        this.instance = instance;
    }

    static has_instance(): boolean {
        return this.instance !== undefined;
    }

    static get_instance(): ITaskTracker {
        if (!this.instance) {
            throw new Error("Task tracker instance not set");
        }
        return this.instance;
    }

}
