import { CollectionReference, Firestore } from "@google-cloud/firestore";

import { GoogleAuth } from "@src/api/google_auth.js";
import {
    NewTaskData,
    TaskData,
    TaskFilter,
    TaskStatus,
    TaskUpdate,
    create_task_update,
    filter_tasks,
} from "@src/entities/task.js";
import { generate_task_id } from "@src/utils/misc.js";
import { ITaskTracker } from "@src/interfaces/task_tracker.js";
import { Journal } from "@src/journal.js";
import { Expected } from "@src/utils/expected.js";
import { TokenBucket } from "@src/utils/token_bucket.js";

export type Config = {
    database_id: string;
    collection_name: string;
}

const CURRENT_SCHEMA = 1;
const MAX_ID_COLLISION_RETRIES = 10;

type FirestoreTimestamp = {
    _seconds: number;
}

function parse_timestamp(value: unknown): Date | undefined {
    if (value == undefined) {
        return undefined;
    }
    if (value instanceof Date) {
        return value;
    }
    if (typeof value === "object" && value !== null && "_seconds" in value) {
        return new Date((value as FirestoreTimestamp)._seconds * 1000);
    }
    return undefined;
}

function parse_status(status: unknown): TaskStatus | undefined {
    if (typeof status !== "string") {
        return undefined;
    }
    switch (status) {
        case "pending":
        case "in_progress":
        case "completed":
        case "cancelled":
            return status;
        default:
            return undefined;
    }
}

function get_optional_string(value: unknown): string | undefined {
    if (typeof value !== "string") {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

function try_parse_document(doc_id: string, data: Record<string, unknown>): Expected<TaskData> {
    const id = typeof data.id === "string" && data.id.length > 0 ? data.id : doc_id;
    const schema = typeof data.schema === "number" ? data.schema : undefined;
    if (schema == undefined) {
        return Expected.err(`task '${id}' is missing schema`);
    }

    const created_at = parse_timestamp(data.created_at);
    if (!created_at) {
        return Expected.err(`task '${id}' has invalid created_at`);
    }

    const author = get_optional_string(data.author);
    if (!author) {
        return Expected.err(`task '${id}' is missing author`);
    }

    const title = get_optional_string(data.title);
    if (!title) {
        return Expected.err(`task '${id}' is missing title`);
    }

    const status = parse_status(data.status);
    if (!status) {
        return Expected.err(`task '${id}' has invalid status`);
    }

    const deadline = parse_timestamp(data.deadline);
    if (data.deadline != undefined && data.deadline !== null && !deadline) {
        return Expected.err(`task '${id}' has invalid deadline`);
    }

    return Expected.ok({
        id,
        schema,
        created_at,
        author,
        title,
        comment: get_optional_string(data.comment),
        status,
        deadline,
        manager: get_optional_string(data.manager),
        assignee: get_optional_string(data.assignee),
    });
}

function to_firestore_document(task: TaskData): Record<string, unknown> {
    return {
        id: task.id,
        schema: task.schema,
        created_at: task.created_at,
        author: task.author,
        title: task.title,
        comment: task.comment ?? null,
        status: task.status,
        deadline: task.deadline ?? null,
        manager: task.manager ?? null,
        assignee: task.assignee ?? null,
    };
}

function is_already_exists_error(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("ALREADY_EXISTS") || message.includes("already exists");
}

export class GoogleFirestoreTaskTracker implements ITaskTracker {
    private readonly db: Firestore;
    private readonly collection: CollectionReference;
    private readonly journal: Journal;
    private readonly api_tokens: TokenBucket;

    constructor(
        private readonly config: Config,
        parent_journal: Journal,
    ) {
        this.db = GoogleAuth.get_firestore(this.config.database_id);
        this.collection = this.db.collection(this.config.collection_name);
        this.journal = parent_journal.child("task_tracker");
        this.api_tokens = new TokenBucket({
            max_tokens: 20,
            refill_rate: 5,
        });
    }

    async fetch(filter?: TaskFilter): Promise<Expected<TaskData[]>> {
        const tasks_status = await this.fetch_all();
        if (!tasks_status.ok) {
            return tasks_status;
        }
        return Expected.ok(filter_tasks(tasks_status.value, filter));
    }

    async create(task: NewTaskData): Promise<Expected<TaskData>> {
        const created_at = new Date();
        for (let attempt = 0; attempt < MAX_ID_COLLISION_RETRIES; attempt++) {
            const id = generate_task_id(created_at);
            const created_task: TaskData = {
                ...task,
                id,
                schema: CURRENT_SCHEMA,
                created_at,
            };

            try {
                await this.api_tokens.wait_tokens(1);
                await this.collection.doc(id).create(to_firestore_document(created_task));
            } catch (error) {
                if (is_already_exists_error(error)) {
                    continue;
                }
                const message = error instanceof Error ? error.message : String(error);
                return Expected.err(message).wrap_error("failed to create task");
            }

            const stored_status = await this.read_document(id);
            if (!stored_status.ok) {
                return stored_status.cast_error<TaskData>().wrap_error("failed to read created task");
            }

            return Expected.ok(stored_status.value);
        }

        return Expected.err("failed to generate a unique task id");
    }

    async update(task: TaskData): Promise<Expected<TaskUpdate>> {
        const previous_status = await this.read_document(task.id);
        if (!previous_status.ok) {
            return previous_status.cast_error<TaskUpdate>();
        }

        const update = create_task_update(previous_status.value, task);
        if (Object.keys(update.updates).length === 0) {
            return Expected.ok(update);
        }

        try {
            await this.api_tokens.wait_tokens(1);
            await this.collection.doc(task.id).set(to_firestore_document(task));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return Expected.err(message).wrap_error("failed to update task");
        }

        const stored_status = await this.read_document(task.id);
        if (!stored_status.ok) {
            return stored_status.cast_error<TaskUpdate>().wrap_error("failed to read updated task");
        }

        return Expected.ok(create_task_update(previous_status.value, stored_status.value));
    }

    async delete(task: TaskData): Promise<Expected<TaskData>> {
        const previous_status = await this.read_document(task.id);
        if (!previous_status.ok) {
            return previous_status;
        }

        try {
            await this.api_tokens.wait_tokens(1);
            await this.collection.doc(task.id).delete();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return Expected.err(message).wrap_error("failed to delete task");
        }

        return Expected.ok(previous_status.value);
    }

    private async fetch_all(): Promise<Expected<TaskData[]>> {
        try {
            await this.api_tokens.wait_tokens(1);
            const snapshot = await this.collection.get();
            const tasks: TaskData[] = [];
            let invalid_docs = 0;

            snapshot.forEach((doc) => {
                const parsed_status = try_parse_document(doc.id, doc.data());
                if (!parsed_status.ok) {
                    invalid_docs++;
                    this.journal.log().warn(
                        `Failed to parse task document '${doc.id}': ${parsed_status.error}`,
                    );
                    return;
                }

                tasks.push(parsed_status.value);
            });

            if (invalid_docs > 0) {
                this.journal.log().warn(`Skipped ${invalid_docs} invalid task documents`);
            }

            this.journal.log().info(`Fetched ${tasks.length} tasks from Firestore`);
            return Expected.ok(tasks);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return Expected.err(message).wrap_error("failed to fetch tasks from Firestore");
        }
    }

    private async read_document(id: string): Promise<Expected<TaskData>> {
        try {
            await this.api_tokens.wait_tokens(1);
            const doc = await this.collection.doc(id).get();
            if (!doc.exists) {
                return Expected.err(`task document '${id}' not found`);
            }
            return try_parse_document(id, doc.data() as Record<string, unknown>);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return Expected.err(message).wrap_error(`failed to read task document '${id}'`);
        }
    }
}
