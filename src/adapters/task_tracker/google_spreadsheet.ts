import { GoogleSpreadsheet } from "@src/api/google_docs.js";
import {
    NewTaskData,
    TaskData,
    TaskFilter,
    TaskStatus,
    TaskUpdate,
    create_task_update,
    filter_tasks,
} from "@src/entities/task.js";
import { ITaskTracker } from "@src/interfaces/task_tracker.js";
import { Journal } from "@src/journal.js";
import { Expected } from "@src/utils/expected.js";

export type Config = {
    spreadsheet_id: string;
    sheet_name: string;
    fetch_interval_sec: number;
}

type TableColumns = {
    created_at: number;
    author_email: number;
    title: number;
    comment: number;
    status: number;
    deadline: number;
    manager: number;
    assignee: number;
}

type CacheEntry = {
    task: TaskData;
    row_index: number;
};

function normalize_header_name(name: string): string {
    return name.toLowerCase().trim();
}

function try_parse_header(header: string[]): Expected<TableColumns> {
    const columns = header.map(normalize_header_name);
    const result: Partial<TableColumns> = {};

    const aliases: Record<keyof TableColumns, string[]> = {
        created_at: ["отметка времени"],
        author_email: ["адрес электронной почты"],
        title: ["заголовок"],
        comment: ["комментарий"],
        status: ["статус"],
        deadline: ["дедлайн"],
        manager: ["менеджер"],
        assignee: ["исполнитель"],
    };

    (Object.keys(aliases) as (keyof TableColumns)[]).forEach((field) => {
        const column_idx = columns.findIndex(name => aliases[field].includes(name));
        if (column_idx >= 0) {
            result[field] = column_idx;
        }
    });

    for (const field of Object.keys(aliases) as (keyof TableColumns)[]) {
        if (result[field] == undefined) {
            return Expected.err(`No '${field}' column found`);
        }
    }

    return Expected.ok(result as TableColumns);
}

function parse_datetime(value: string): Date | undefined {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
        return undefined;
    }

    const match = trimmed.match(
        /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?: (\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
    );
    if (!match) {
        const fallback = new Date(trimmed);
        if (Number.isNaN(fallback.getTime())) {
            return undefined;
        }
        return fallback;
    }

    const [
        ,
        day_str,
        month_str,
        year_str,
        hour_str = "0",
        minute_str = "0",
        second_str = "0",
    ] = match;

    const day = parseInt(day_str, 10);
    const month = parseInt(month_str, 10) - 1;
    const year = parseInt(year_str, 10);
    const hour = parseInt(hour_str, 10);
    const minute = parseInt(minute_str, 10);
    const second = parseInt(second_str, 10);

    const date = new Date(year, month, day, hour, minute, second);
    if (
        Number.isNaN(date.getTime()) ||
        date.getFullYear() !== year ||
        date.getMonth() !== month ||
        date.getDate() !== day ||
        date.getHours() !== hour ||
        date.getMinutes() !== minute ||
        date.getSeconds() !== second
    ) {
        return undefined;
    }

    return date;
}

function parse_status(status: string): TaskStatus | undefined {
    switch (status.trim().toLowerCase()) {
        case "to do":
            return "pending";
        case "in progress":
            return "in_progress";
        case "done":
            return "completed";
        case "cancelled":
            return "cancelled";
        default:
            return undefined;
    }
}

function pad_2(value: number): string {
    return value.toString().padStart(2, "0");
}

function format_datetime(date: Date): string {
    return [
        `${pad_2(date.getDate())}.${pad_2(date.getMonth() + 1)}.${date.getFullYear()}`,
        `${pad_2(date.getHours())}:${pad_2(date.getMinutes())}:${pad_2(date.getSeconds())}`,
    ].join(" ");
}

function format_status(status: TaskStatus): string {
    switch (status) {
        case "pending":
            return "To Do";
        case "in_progress":
            return "In Progress";
        case "completed":
            return "Done";
        case "cancelled":
            return "Cancelled";
    }
}

function get_optional_value(row: string[], idx: number): string | undefined {
    const value = row[idx]?.trim() ?? "";
    return value.length > 0 ? value : undefined;
}

function try_parse_row(row: string[], columns: TableColumns): Expected<TaskData> {
    const created_at_raw = row[columns.created_at]?.trim() ?? "";
    if (created_at_raw.length === 0) {
        return Expected.err("created_at is empty");
    }
    const created_at = parse_datetime(created_at_raw);
    if (!created_at) {
        return Expected.err(`invalid created_at value '${created_at_raw}'`);
    }

    const author_email = row[columns.author_email]?.trim() ?? "";
    if (author_email.length === 0) {
        return Expected.err("author_email is empty");
    }

    const title = row[columns.title]?.trim() ?? "";
    if (title.length === 0) {
        return Expected.err("title is empty");
    }

    const status_raw = row[columns.status]?.trim() ?? "";
    const status = parse_status(status_raw);
    if (!status) {
        return Expected.err(`invalid status '${status_raw}'`);
    }

    const deadline_raw = row[columns.deadline]?.trim() ?? "";
    const deadline = deadline_raw.length > 0 ? parse_datetime(deadline_raw) : undefined;
    if (deadline_raw.length > 0 && !deadline) {
        return Expected.err(`invalid deadline value '${deadline_raw}'`);
    }

    return Expected.ok({
        created_at,
        author_email,
        title,
        comment: get_optional_value(row, columns.comment),
        status,
        deadline,
        manager: get_optional_value(row, columns.manager),
        assignee: get_optional_value(row, columns.assignee),
    });
}

function format_row(task: TaskData, columns: TableColumns): string[] {
    const max_column = Math.max(...Object.values(columns));
    const row = Array.from({ length: max_column + 1 }, () => "");

    row[columns.created_at] = format_datetime(task.created_at);
    row[columns.author_email] = task.author_email;
    row[columns.title] = task.title;
    row[columns.comment] = task.comment ?? "";
    row[columns.status] = format_status(task.status);
    row[columns.deadline] = task.deadline ? format_datetime(task.deadline) : "";
    row[columns.manager] = task.manager ?? "";
    row[columns.assignee] = task.assignee ?? "";

    return row;
}

function created_at_matches(left: Date, right: Date): boolean {
    return left.getTime() === right.getTime();
}

export class GoogleSheetTaskTracker implements ITaskTracker {
    private readonly sheet: GoogleSpreadsheet;
    private readonly journal: Journal;

    private columns?: TableColumns;
    private cache: CacheEntry[] = [];
    private next_fetch: Date = new Date(0);

    constructor(
        private readonly config: Config,
        parent_journal: Journal,
    ) {
        this.sheet = new GoogleSpreadsheet(config.spreadsheet_id);
        this.journal = parent_journal.child("task_tracker");
    }

    async fetch(filter?: TaskFilter): Promise<Expected<TaskData[]>> {
        const now = new Date();
        if (now < this.next_fetch) {
            return Expected.ok([...filter_tasks(this.get_tasks(), filter)]);
        }

        const load_status = await this.read_and_update_cache();
        if (!load_status.ok) {
            return load_status.cast_error<TaskData[]>();
        }
        this.journal.log().info(`Fetched ${this.cache.length} tasks`);

        this.next_fetch = new Date(Date.now() + this.config.fetch_interval_sec * 1000);
        return Expected.ok([...filter_tasks(this.get_tasks(), filter)]);
    }

    async create(task: NewTaskData): Promise<Expected<TaskData>> {
        const load_status = await this.read_and_update_cache();
        if (!load_status.ok) {
            return load_status.cast_error<TaskData>();
        }
        if (!this.columns) {
            return Expected.err("task table columns are not loaded");
        }

        const created_task: TaskData = {
            ...task,
            created_at: new Date(),
        };
        const row = format_row(created_task, this.columns);
        const append_status = await this.sheet.append(
            `${this.config.sheet_name}`,
            row,
        );
        if (!append_status.ok) {
            return append_status.cast_error<TaskData>().wrap_error("failed to create task");
        }

        const refresh_status = await this.read_and_update_cache();
        if (!refresh_status.ok) {
            return refresh_status.cast_error<TaskData>().wrap_error("failed to refresh task cache");
        }

        return Expected.ok(created_task);
    }

    async update(task: TaskData): Promise<Expected<TaskUpdate>> {
        const load_status = await this.read_and_update_cache();
        if (!load_status.ok) {
            return load_status.cast_error<TaskUpdate>();
        }
        if (!this.columns) {
            return Expected.err("task table columns are not loaded");
        }

        const located_status = await this.locate_task(task.created_at);
        if (!located_status.ok) {
            return located_status.cast_error<TaskUpdate>();
        }

        const { previous, row_index } = located_status.value;
        const update = create_task_update(previous, task);
        if (Object.keys(update.updates).length === 0) {
            return Expected.ok(update);
        }

        const row = format_row(task, this.columns);
        const write_status = await this.sheet.write(
            `${this.config.sheet_name}!A${row_index + 1}:H${row_index + 1}`,
            row,
        );
        if (!write_status.ok) {
            return write_status.cast_error<TaskUpdate>().wrap_error("failed to update task");
        }

        const refresh_status = await this.read_and_update_cache();
        if (!refresh_status.ok) {
            return refresh_status.cast_error<TaskUpdate>().wrap_error("failed to refresh task cache");
        }

        return Expected.ok(update);
    }

    async delete(task: TaskData): Promise<Expected<TaskData>> {
        const load_status = await this.read_and_update_cache();
        if (!load_status.ok) {
            return load_status.cast_error<TaskData>();
        }

        const located_status = await this.locate_task(task.created_at);
        if (!located_status.ok) {
            return located_status.cast_error<TaskData>();
        }

        const { previous, row_index } = located_status.value;
        const delete_status = await this.sheet.delete_row(this.config.sheet_name, row_index);
        if (!delete_status.ok) {
            return delete_status.cast_error<TaskData>().wrap_error("failed to delete task");
        }

        const refresh_status = await this.read_and_update_cache();
        if (!refresh_status.ok) {
            return refresh_status.cast_error<TaskData>().wrap_error("failed to refresh task cache");
        }

        return Expected.ok(previous);
    }

    private get_tasks(): TaskData[] {
        return this.cache.map(entry => entry.task);
    }

    private find_cache_entry(created_at: Date): CacheEntry | undefined {
        return this.cache.find(entry => created_at_matches(entry.task.created_at, created_at));
    }

    private async locate_task(created_at: Date): Promise<Expected<{
        previous: TaskData;
        row_index: number;
    }>> {
        const entry = this.find_cache_entry(created_at);
        if (!entry) {
            return Expected.err(`task with created_at '${created_at.toISOString()}' not found in cache`);
        }
        if (!this.columns) {
            return Expected.err("task table columns are not loaded");
        }

        const row_number = entry.row_index + 1;
        const row_status = await this.sheet.read(
            `${this.config.sheet_name}!A${row_number}:H${row_number}`,
        );
        if (!row_status.ok) {
            return row_status.cast_error();
        }

        const row = row_status.value[0];
        if (!row) {
            return Expected.err(`task row #${row_number} is empty`);
        }

        const parsed_status = try_parse_row(row, this.columns);
        if (!parsed_status.ok) {
            return parsed_status.cast_error();
        }

        if (!created_at_matches(parsed_status.value.created_at, created_at)) {
            return Expected.err(
                [
                    `task row #${row_number} created_at mismatch:`,
                    `expected '${created_at.toISOString()}',`,
                    `got '${parsed_status.value.created_at.toISOString()}'`,
                ].join(" "),
            );
        }

        return Expected.ok({
            previous: parsed_status.value,
            row_index: entry.row_index,
        });
    }

    private async read_and_update_cache(): Promise<Expected<void>> {
        const sheet_status = await this.sheet.read(`${this.config.sheet_name}`);
        if (!sheet_status.ok) {
            return sheet_status.wrap_error("can't fetch sheet data");
        }

        const table = sheet_status.value;
        if (table.length === 0) {
            this.columns = undefined;
            this.cache = [];
            return Expected.ok(undefined);
        }

        const columns_status = try_parse_header(table[0]);
        if (!columns_status.ok) {
            return columns_status.wrap_error("invalid task table header");
        }

        const columns = columns_status.value;
        const cache: CacheEntry[] = [];
        let invalid_rows = 0;

        table.slice(1).forEach((row, row_idx) => {
            const is_empty = row.every(cell => cell.trim().length === 0);
            if (is_empty) {
                return;
            }

            const task_status = try_parse_row(row, columns);
            if (!task_status.ok) {
                invalid_rows++;
                this.journal.log().warn(
                    `Failed to parse task row #${row_idx + 2}: ${task_status.error}`,
                );
                return;
            }

            cache.push({
                task: task_status.value,
                row_index: row_idx + 1,
            });
        });

        if (invalid_rows > 0) {
            this.journal.log().warn(`Skipped ${invalid_rows} invalid task rows`);
        }

        this.columns = columns;
        this.cache = cache;
        return Expected.ok(undefined);
    }
}
