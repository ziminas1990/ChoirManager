import mustache from "mustache";

import { GoogleSpreadsheet } from "@src/api/google_docs.js";
import { Language } from "@src/database.js";
import { IMessagesProvider } from "@src/interfaces/messages_provider.js";
import { Journal } from "@src/journal.js";
import { Expected, Status } from "@src/utils/expected.js";

enum MessageId {
    AttendanceNotification = "ATTENDANCE_NOTIFICATION",
    AttendanceRemindersReport = "ATTENDANCE_REMINDERS_REPORT",
}

const ALL_MESSAGE_IDS = [
    MessageId.AttendanceNotification,
    MessageId.AttendanceRemindersReport,
] as const satisfies MessageId[];

const REFETCH_INTERVAL_MS = 60 * 60 * 1000;

type MessageColumns = {
    message: number;
    en: number;
    ru: number;
};

function try_parse_header(header: string[]): Expected<MessageColumns> {
    const columns = header.map(value => value.trim().toLowerCase());
    const message = columns.indexOf("message");
    const en = columns.indexOf("en");
    const ru = columns.indexOf("ru");

    if (message < 0) {
        return Expected.err("No 'Message' column found");
    }
    if (en < 0) {
        return Expected.err("No 'EN' column found");
    }
    if (ru < 0) {
        return Expected.err("No 'RU' column found");
    }

    return Expected.ok({ message, en, ru });
}

function try_parse_templates(table: string[][]): Expected<Map<string, Record<Language, string>>> {
    if (table.length === 0) {
        return Expected.ok(new Map());
    }

    const header_status = try_parse_header(table[0]);
    if (!header_status.ok) {
        return header_status.cast_error();
    }
    const columns = header_status.value;

    const templates = new Map<string, Record<Language, string>>();
    for (const [row_index, row] of table.slice(1).entries()) {
        const message_id = row[columns.message]?.trim();
        if (!message_id) {
            continue;  // empty row is ok
        }
        if (templates.has(message_id)) {
            return Expected.err(`Duplicate message identifier '${message_id}' at row ${row_index + 2}`);
        }

        if (!ALL_MESSAGE_IDS.includes(message_id as MessageId)) {
            return Expected.err(`Unknown message identifier '${message_id}' at row ${row_index + 2}`);
        }

        templates.set(message_id, {
            [Language.EN]: row[columns.en]?.trim(),
            [Language.RU]: row[columns.ru]?.trim(),
        });
    }

    const all_languages = [Language.EN, Language.RU] as const;

    for (const message_id of ALL_MESSAGE_IDS) {
        if (!templates.has(message_id)) {
            return Expected.err(`Message '${message_id}' not found`);
        }
        for (const lang of all_languages) {
            if (templates.get(message_id)?.[lang] === undefined) {
                return Expected.err(`Message '${message_id}' is missing ${lang} text`);
            }
        }
    }

    return Expected.ok(templates);
}

export class GoogleSpreadsheetMessagesProvider implements IMessagesProvider {
    private readonly sheet: GoogleSpreadsheet;
    private readonly journal: Journal;
    private readonly range: string;

    private last_fetch_date?: Date;
    private templates = new Map<string, Record<Language, string>>();

    constructor(google_sheet_id: string, table_name: string, parent_journal: Journal)
    {
        this.sheet = new GoogleSpreadsheet(google_sheet_id);
        this.range = `${table_name}`;
        this.journal = parent_journal.child("messages_provider");
    }

    async init(): Promise<Status> {
        return await this.refetch();
    }

    async proceed(): Promise<Status> {
        if (!this.time_to_refetch()) {
            return Expected.ok(undefined);
        }
        return await this.refetch();
    }

    get_attendance_notification_message(lang: Language, params: {
        chorister_name: string;
        skipped_rehersals: number;
    }): string {
        return this.render_message(MessageId.AttendanceNotification, lang, params);
    }

    get_attendance_reminders_report_message(lang: Language, params: {
        choristers_list: string;
    }): string {
        return this.render_message(MessageId.AttendanceRemindersReport, lang, params);
    }

    private render_message(
        message_id: MessageId,
        lang: Language,
        params: Record<string, unknown>,
    ): string {
        const template = this.templates.get(message_id)?.[lang]
            ?? this.templates.get(message_id)?.[Language.EN];
        if (!template) {
            return "";
        }

        return mustache.render(template, params);
    }

    private async refetch(): Promise<Status> {
        const table_status = await this.sheet.read(this.range);
        if (!table_status.ok) {
            return table_status.wrap_error("Failed to read messages sheet");
        }

        const templates_status = try_parse_templates(table_status.value);
        if (!templates_status.ok) {
            return templates_status.wrap_error("Failed to parse messages sheet");
        }

        this.templates = templates_status.value;
        this.last_fetch_date = new Date();
        this.journal.log().info({
            messages_count: this.templates.size,
        }, "Messages sheet refreshed");
        return Expected.ok(undefined);
    }

    private time_to_refetch(): boolean {
        if (!this.last_fetch_date) {
            return true;
        }
        return Date.now() - this.last_fetch_date.getTime() >= REFETCH_INTERVAL_MS;
    }
}
