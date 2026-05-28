import { GoogleSpreadsheet, Row } from "@src/api/google_docs.js";
import { Config } from "@src/config.js";
import { IAdapter, TableRecord } from "@src/interfaces/adapter.js";
import { Journal } from "@src/journal.js";
import { Expected, Status } from "@src/utils/expected.js";

type TableConfig = {
    google_sheet_id: string;
    sheet: string;
    name: string;
    key_column: number;
}

type RowSnapshot = {
    key: string;
    record: TableRecord;
}

function table_key(cfg: TableConfig): string {
    return `${cfg.google_sheet_id}:${cfg.sheet}`;
}

function sheet_range(sheet: string): string {
    const escaped_sheet = sheet.replace(/'/g, "''");
    return `'${escaped_sheet}'!A:ZZZ`;
}

function normalize_row(row: Row, width: number): string[] {
    return Array.from({ length: width }, (_, idx) => row[idx] ?? "");
}

export class NewRecordsFetcher {
    private last_fetch_date?: Date;
    private snapshots: Map<string, Set<string>> = new Map();
    private readonly journal: Journal;

    constructor(
        parent_journal: Journal,
        private readonly get_adapters: () => IAdapter[])
    {
        this.journal = parent_journal.child("new_records_fetcher");
    }

    async start(): Promise<Status> {
        return await this.proceed();
    }

    async proceed(): Promise<Status> {
        if (!this.time_to_fetch()) {
            return Expected.ok(undefined);
        }

        for (const table of Config.NewRecordsTracker().tables) {
            const status = await this.check_table(table);
            if (!status.ok) {
                this.journal.log().warn(`Failed to check table '${table.name}': ${status.error}`);
            }
        }

        return Expected.ok(undefined);
    }

    private async check_table(cfg: TableConfig): Promise<Status> {
        const sheet = new GoogleSpreadsheet(cfg.google_sheet_id);
        const table_status = await sheet.read(sheet_range(cfg.sheet));
        if (!table_status.ok) {
            return table_status.wrap_error("can't fetch sheet data");
        }

        const rows = table_status.value;
        if (rows.length === 0) {
            return Expected.ok(undefined);
        }
        if (rows[0].length < cfg.key_column) {
            return Expected.err(`key column ${cfg.key_column} is outside of table header`);
        }

        const snapshots = this.build_snapshots(cfg, rows);
        const next_keys = new Set(snapshots.map(snapshot => snapshot.key));

        const key = table_key(cfg);
        const previous_keys = this.snapshots.get(key);
        if (!previous_keys) {
            this.snapshots.set(key, next_keys);
            this.journal.log().info(`Initialized snapshot for table '${cfg.name}'`);
            return Expected.ok(undefined);
        }

        for (const snapshot of snapshots) {
            if (!previous_keys.has(snapshot.key)) {
                const status = await this.notify_managers(snapshot.record);
                if (!status.ok) {
                    return status.wrap_error("failed to notify managers");
                }
            }
        }

        this.snapshots.set(key, next_keys);
        return Expected.ok(undefined);
    }

    private build_snapshots(cfg: TableConfig, rows: Row[]): RowSnapshot[] {
        const header = rows[0];
        const key_column_idx = cfg.key_column - 1;
        const width = Math.max(header.length, key_column_idx + 1);
        const fields = header.map(field => field.trim());

        return rows.slice(1)
            .map(row => normalize_row(row, width))
            .filter(row => row.some(value => value.trim().length > 0))
            .filter(row => row[key_column_idx]?.trim().length > 0)
            .map(row => ({
                key: row[key_column_idx].trim(),
                record: {
                    table_name: cfg.name,
                    fields: fields
                        .map((name, idx) => ({ name, value: row[idx] }))
                        .filter(field => field.name.length > 0),
                },
            }));
    }

    private async notify_managers(record: TableRecord): Promise<Status> {
        let sent = false;
        for (const adapter of this.get_adapters()) {
            const managers_chat = await adapter.get_managers_chat();
            if (!managers_chat) {
                continue;
            }
            const status = await managers_chat.on_new_table_record(record);
            if (!status.ok) {
                return status.wrap_error("manager chat notification failed");
            }
            sent = true;
        }
        if (!sent) {
            return Expected.err("managers chat is not configured");
        }
        return Expected.ok(undefined);
    }

    // Check if it is time to fetch data since previous check.
    // NOTE: if function returns true, last_fetch_date is set to current time.
    private time_to_fetch(): boolean {
        const now_ms = new Date().getTime();
        if (!this.last_fetch_date) {
            this.last_fetch_date = new Date();
            return true;
        }
        const fetch_interval_ms = Config.NewRecordsTracker().fetch_interval_sec * 1000;
        const time_since_last_fetch = now_ms - this.last_fetch_date.getTime();
        if (time_since_last_fetch < fetch_interval_ms) {
            return false;
        }
        this.last_fetch_date = new Date();
        return true;
    }
}
