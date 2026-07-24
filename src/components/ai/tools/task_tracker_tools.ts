import { z } from "zod";

import { TaskData, TaskFilter, TaskStatus, TaskUpdate, get_task_id } from "@src/entities/task.js";
import { IToolchain, Tool } from "@src/interfaces/llm.js";
import { ITaskTrackerService } from "@src/interfaces/task_tracker_service.js";
import { parse_optional_datetime } from "@src/utils/common_parsers.js";
import { Expected } from "@src/utils/expected.js";
import { empty_parameters_schema, parse_tool_parameters, tool_from_schema } from "./tool_schema.js";

const OPEN_TASK_STATUSES: TaskStatus[] = ["pending", "in_progress"];
const GET_ALL_TASKS_LIMIT = 50;

const task_status_schema = z.enum([
    "pending",
    "in_progress",
    "completed",
    "cancelled",
] satisfies [TaskStatus, ...TaskStatus[]]);

const task_datetime_schema = z.string()
    .trim()
    .min(1)
    .describe("Datetime in ISO 8601 or DD.MM.YYYY HH:MM[:SS] format.");

const nullable_text_schema = z.union([z.string().trim().min(1), z.null()]);
const nullable_datetime_schema = z.union([task_datetime_schema, z.null()]);

const get_all_tasks_schema = z.object({
    status: z.array(task_status_schema)
        .optional()
        .describe("Optional list of task statuses to include."),
}).strict();

const create_task_schema = z.object({
    title: z.string().trim().min(1).describe("Task title."),
    author: z.string()
        .trim()
        .min(1)
        .optional()
        .describe("Optional task author. Defaults to the managers chat agent if omitted."),
    comment: z.string().trim().min(1).optional().describe("Optional task comment."),
    status: task_status_schema.optional().describe("Optional initial task status. Defaults to pending."),
    deadline: task_datetime_schema.optional().describe("Optional task deadline."),
    manager: z.string().trim().min(1).optional().describe("Optional manager name."),
    assignee: z.string().trim().min(1).optional().describe("Optional assignee name."),
}).strict();

const update_task_schema = z.object({
    task_id: z.string().trim().min(1).describe("Task id returned by get_opened_tasks or get_all_tasks."),
    author: z.string().trim().min(1).optional().describe("New task author."),
    title: z.string().trim().min(1).optional().describe("New task title."),
    comment: nullable_text_schema.optional().describe("Set to a string to update comment, or null to clear it."),
    status: task_status_schema.optional().describe("New task status."),
    deadline: nullable_datetime_schema.optional().describe("Set to a datetime string to update deadline, or null to clear it."),
    manager: nullable_text_schema.optional().describe("Set to a string to update manager, or null to clear it."),
    assignee: nullable_text_schema.optional().describe("Set to a string to update assignee, or null to clear it."),
}).strict();

const delete_task_schema = z.object({
    task_id: z.string().trim().min(1).describe("Task id returned by get_opened_tasks or get_all_tasks."),
}).strict();

type SerializableTaskData = Omit<TaskData, "created_at" | "deadline"> & {
    task_id: string;
    created_at: string;
    deadline?: string;
}

const DEFAULT_AUTHOR = "Ursa Major Bot";
const UPDATEABLE_FIELDS = [
    "author",
    "title",
    "comment",
    "status",
    "deadline",
    "manager",
    "assignee",
] as const;

function serialize_task(task: TaskData): SerializableTaskData {
    return {
        task_id: get_task_id(task),
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

function return_created_task(task: TaskData): string {
    return JSON.stringify({task: serialize_task(task) });
}

function return_updated_task(task: TaskData, update: TaskUpdate): string {
    return JSON.stringify({
        changed: Object.keys(update.updates).length > 0,
        updated_fields: Object.keys(update.updates),
        task: serialize_task(task),
    });
}

function return_deleted_task(task: TaskData): string {
    return JSON.stringify({ task: serialize_task(task) });
}

function has_task_changes(parameters: z.infer<typeof update_task_schema>): boolean {
    return UPDATEABLE_FIELDS.some(field => Object.prototype.hasOwnProperty.call(parameters, field));
}

const TASK_TRACKER_USE_CASES = `
If user asks to list, show, or inspect tasks without explicitly asking to include (completed/cancelled) tasks:
- call get_opened_tasks
- send a message with the relevant tasks from the result

If user explicitly asks to list, show, or inspect tasks including completed/cancelled tasks:
- call get_all_tasks, optionally with a status filter
- if the tool fails because too many tasks match, ask the user to narrow by status, then retry with a status filter
- send a message with the relevant tasks from the result

If user explicitly asks to create a new task:
- just call create_task with the provided fields
- do not send a confirmation message; the task tracker event will appear in the chat automatically

If user asks to update, reassign, reschedule, complete, cancel, or otherwise edit a task:
- call get_opened_tasks first to find a target open task
- if the target may be a completed/cancelled task, call get_all_tasks with an appropriate status filter
- if more than one task matches or the target is ambiguous, ask a clarifying question instead of guessing
- once the task is identified unambiguously, call update_task with only the fields that should change
- if the result has changed=true, do not send a confirmation message; the task tracker event will appear in the chat automatically
- if the result has changed=false, send a short message explaining that nothing changed

If user explicitly asks to delete a task:
- call get_opened_tasks first to find a target open task
- if the target may be a completed/cancelled task, call get_all_tasks with an appropriate status filter
- if more than one task matches or the target is ambiguous, ask a clarifying question instead of guessing
- once the task is identified unambiguously, call delete_task
- do not send a confirmation message; the task tracker event will appear in the chat automatically

If any task tracker tool call fails:
- send a short message that the request could not be completed and include the error reason

General rules:
- Never show task_id to the user unless the user explicitly asked for it
`.trim();

export class TaskTrackerTools implements IToolchain {
    constructor(
        private readonly task_tracker: ITaskTrackerService,
    ) {}

    get_name(): string {
        return "task_tracker";
    }

    get_readme(): string {
        return [
            "Tools for querying and mutating tasks from the task tracker database.",
            "Use get_opened_tasks by default to inspect open tasks (pending, in_progress).",
            "Use get_all_tasks only when the user explicitly asks to include closed tasks, or asks about tasks that were changed/worked on.",
            "get_all_tasks accepts an optional status filter and rejects result sets larger than 50 tasks.",
            "Never show task_id to the user unless the user explicitly asked for it; use it only as an internal identifier for update_task and delete_task.",
            "Use create_task only for explicit requests to create a task.",
            "Use update_task only when the target task is identified unambiguously by task_id.",
            "Use delete_task only for explicit deletion requests and only after identifying the task by task_id.",
            "Optional fields comment, deadline, manager, and assignee can be cleared in update_task by passing null.",
        ].join("\n");
    }

    get_use_cases(): string {
        return TASK_TRACKER_USE_CASES;
    }

    get_tools(): Map<string, Tool> {
        return new Map([
            ["get_opened_tasks", tool_from_schema(
                "get_opened_tasks",
                [
                    "Fetch open tasks from the task tracker database.",
                    "Returns only pending and in_progress tasks.",
                    "Returns a JSON object with a 'tasks' array.",
                    "Each task includes a stable task_id.",
                ].join("\n"),
                empty_parameters_schema,
            )],
            ["get_all_tasks", tool_from_schema(
                "get_all_tasks",
                [
                    "Fetch tasks from the task tracker database, including closed ones when no status filter is set.",
                    "Prefer get_opened_tasks unless the user explicitly asks to include completed/cancelled tasks or asks about changed/worked-on tasks.",
                    "Optional filter: status.",
                    `Rejects the request if more than ${GET_ALL_TASKS_LIMIT} tasks match; narrow by status and retry.`,
                    "Returns a JSON object with a 'tasks' array.",
                    "Each task includes a stable task_id.",
                ].join("\n"),
                get_all_tasks_schema,
            )],
            ["create_task", tool_from_schema(
                "create_task",
                [
                    "Create a new task in the task tracker database.",
                    "Returns the created task including task_id and created_at.",
                    "If author is omitted, a default managers chat author is used.",
                ].join("\n"),
                create_task_schema,
            )],
            ["update_task", tool_from_schema(
                "update_task",
                [
                    "Update an existing task identified by task_id.",
                    "Pass only the fields that should change.",
                    "Use null for comment, deadline, manager, or assignee to clear those fields.",
                    "Returns changed=false when the requested update does not modify the task.",
                ].join("\n"),
                update_task_schema,
            )],
            ["delete_task", tool_from_schema(
                "delete_task",
                [
                    "Delete an existing task identified by task_id.",
                ].join("\n"),
                delete_task_schema,
            )],
        ]);
    }

    async call_tool(name: string, parameters: Record<string, unknown>): Promise<Expected<string>> {
        try {
            if (name === "get_opened_tasks") {
                const parsed = parse_tool_parameters(empty_parameters_schema, parameters);
                if (!parsed.ok) {
                    return Expected.err(parsed.error);
                }

                const fetched = await this.task_tracker.fetch({ status: OPEN_TASK_STATUSES });
                if (!fetched.ok) {
                    return Expected.err(fetched.error);
                }
                return Expected.ok(return_tasks(fetched.value));
            }

            if (name === "get_all_tasks") {
                const parsed = parse_tool_parameters(get_all_tasks_schema, parameters);
                if (!parsed.ok) {
                    return Expected.err(parsed.error);
                }

                const filter: TaskFilter | undefined = parsed.value.status === undefined
                    ? undefined
                    : { status: parsed.value.status };
                const fetched = await this.task_tracker.fetch(filter);
                if (!fetched.ok) {
                    return Expected.err(fetched.error);
                }
                if (fetched.value.length > GET_ALL_TASKS_LIMIT) {
                    return Expected.err(
                        `too many tasks match the query (${fetched.value.length} > ${GET_ALL_TASKS_LIMIT}); `
                        + "narrow the query by status",
                    );
                }

                return Expected.ok(return_tasks(fetched.value));
            }

            if (name === "create_task") {
                const parsed = parse_tool_parameters(create_task_schema, parameters);
                if (!parsed.ok) {
                    return Expected.err(parsed.error);
                }

                const deadline_status = parse_optional_datetime(parsed.value.deadline, "deadline");
                if (!deadline_status.ok) {
                    return Expected.err(deadline_status.error);
                }

                const created = await this.task_tracker.create({
                    author: parsed.value.author ?? DEFAULT_AUTHOR,
                    title: parsed.value.title,
                    comment: parsed.value.comment,
                    status: parsed.value.status ?? "pending",
                    deadline: deadline_status.value,
                    manager: parsed.value.manager,
                    assignee: parsed.value.assignee,
                });
                return created.ok
                    ? Expected.ok(return_created_task(created.value))
                    : Expected.err(created.error);
            }

            if (name === "update_task") {
                const parsed = parse_tool_parameters(update_task_schema, parameters);
                if (!parsed.ok) {
                    return Expected.err(parsed.error);
                }
                if (!has_task_changes(parsed.value)) {
                    return Expected.err("at least one task field must be provided for update");
                }

                const fetched = await this.task_tracker.fetch();
                if (!fetched.ok) {
                    return Expected.err(fetched.error);
                }
                const existing = fetched.value.find(task => get_task_id(task) === parsed.value.task_id);
                if (!existing) {
                    return Expected.err(`task with id '${parsed.value.task_id}' not found`);
                }

                const deadline_status = parse_optional_datetime(parsed.value.deadline, "deadline");
                if (!deadline_status.ok) {
                    return Expected.err(deadline_status.error);
                }

                const next: TaskData = { ...existing };
                if (parsed.value.author !== undefined) {
                    next.author = parsed.value.author;
                }
                if (parsed.value.title !== undefined) {
                    next.title = parsed.value.title;
                }
                if (parsed.value.comment !== undefined) {
                    next.comment = parsed.value.comment ?? undefined;
                }
                if (parsed.value.status !== undefined) {
                    next.status = parsed.value.status;
                }
                if (parsed.value.deadline !== undefined) {
                    next.deadline = deadline_status.value;
                }
                if (parsed.value.manager !== undefined) {
                    next.manager = parsed.value.manager ?? undefined;
                }
                if (parsed.value.assignee !== undefined) {
                    next.assignee = parsed.value.assignee ?? undefined;
                }

                const updated = await this.task_tracker.update(next);
                return updated.ok
                    ? Expected.ok(return_updated_task(updated.value.next, updated.value))
                    : Expected.err(updated.error);
            }

            if (name === "delete_task") {
                const parsed = parse_tool_parameters(delete_task_schema, parameters);
                if (!parsed.ok) {
                    return Expected.err(parsed.error);
                }

                const fetched = await this.task_tracker.fetch();
                if (!fetched.ok) {
                    return Expected.err(fetched.error);
                }
                const existing = fetched.value.find(task => get_task_id(task) === parsed.value.task_id);
                if (!existing) {
                    return Expected.err(`task with id '${parsed.value.task_id}' not found`);
                }

                const deleted = await this.task_tracker.delete(existing);
                return deleted.ok
                    ? Expected.ok(return_deleted_task(deleted.value))
                    : Expected.err(deleted.error);
            }

            return Expected.err(`Unknown tool: ${name}`);
        } catch (e) {
            const error = e instanceof Error ? e.message : String(e);
            return Expected.err(error);
        }
    }
}
