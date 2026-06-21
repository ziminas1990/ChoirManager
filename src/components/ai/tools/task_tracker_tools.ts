import { z } from "zod";

import { TaskData, TaskFilter, TaskStatus } from "@src/entities/task.js";
import { IToolchain, Tool } from "@src/interfaces/llm.js";
import { Expected } from "@src/utils/expected.js";
import { parse_tool_parameters, tool_from_schema } from "./tool_schema.js";
import { return_error } from "./tool_response.js";

const task_status_schema = z.enum([
    "pending",
    "in_progress",
    "completed",
    "cancelled",
] satisfies [TaskStatus, ...TaskStatus[]]);

const get_tasks_schema = z.object({
    status: z.array(task_status_schema)
        .optional()
        .describe("Optional list of task statuses to include."),
}).strict();

type SerializableTaskData = Omit<TaskData, "created_at" | "deadline"> & {
    created_at: string;
    deadline?: string;
}

function serialize_task(task: TaskData): SerializableTaskData {
    return {
        ...task,
        created_at: task.created_at.toISOString(),
        deadline: task.deadline?.toISOString(),
    };
}

function return_tasks(tasks: TaskData[]): string {
    return JSON.stringify({
        tasks: tasks.map(serialize_task),
    });
}

export class TaskTrackerTools implements IToolchain {
    constructor(
        private readonly get_tasks: (filter?: TaskFilter) => TaskData[],
    ) {}

    get_name(): string {
        return "task_tracker";
    }

    get_readme(): string {
        return [
            "Tools for querying tasks from the task tracker database.",
            "Use get_tasks to fetch tasks, optionally filtered by status.",
        ].join("\n");
    }

    get_tools(): Map<string, Tool> {
        return new Map([
            ["get_tasks", tool_from_schema(
                "get_tasks",
                [
                    "Fetch tasks from the task tracker database.",
                    "Returns a JSON object with a 'tasks' array.",
                    "Optional status filter accepts: pending, in_progress, completed, cancelled.",
                ].join("\n"),
                get_tasks_schema,
            )],
        ]);
    }

    async call_tool(name: string, parameters: Record<string, unknown>): Promise<Expected<string>> {
        if (name !== "get_tasks") {
            return Expected.err(return_error(`Unknown tool: ${name}`));
        }

        const parsed = parse_tool_parameters(get_tasks_schema, parameters);
        if (!parsed.ok) {
            return Expected.err(return_error(parsed.error));
        }

        const filter: TaskFilter | undefined = parsed.value.status === undefined
            ? undefined
            : { status: parsed.value.status };

        try {
            return Expected.ok(return_tasks(this.get_tasks(filter)));
        } catch (e) {
            const error = e instanceof Error ? e.message : String(e);
            return Expected.err(return_error(error));
        }
    }
}
