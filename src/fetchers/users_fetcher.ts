import { Expected, Status } from "@src/utils/expected.js";
import { GoogleSpreadsheet } from '@src/api/google_docs.js';
import { Database, Language, Role, User, Voice } from '@src/database.js';
import { Journal } from '@src/journal';

export type UsersFetcherConfigJson = {
    google_sheet_id: string;
    range: string;
    fetch_interval_sec: number;
}

export class UsersFetcherConfig {
    constructor(private readonly json: UsersFetcherConfigJson) {}

    get google_sheet_id(): string {
        return this.json.google_sheet_id;
    }

    get range(): string {
        return this.json.range;
    }

    get fetch_interval_sec(): number {
        return this.json.fetch_interval_sec;
    }

    verify(): Status {
        if (!this.json.google_sheet_id) {
            return Expected.err("'google_sheet_id' MUST be specified");
        }
        if (!this.json.range) {
            return Expected.err("'range' MUST be specified");
        }
        if (!this.json.fetch_interval_sec) {
            return Expected.err("'fetch_interval_sec' MUST be specified");
        }
        if (this.json.fetch_interval_sec < 10) {
            return Expected.err("'fetch_interval_sec' MUST be at least 10 seconds");
        }
        return Expected.ok(undefined);
    }
}

type TableColumns = {
    tgid: number,
    name: number,
    language: number,
    voice: number,
    chorister: number,
    manager: number,
    admin: number,
    ex_chorister: number,
    accountant: number,
    conductor: number
}

function try_parse_header(header: string[]): Expected<TableColumns> {
    try {
        const columns = header.map(h => h.toLowerCase().trim());

        const info: Partial<TableColumns> = {}
        const names: (keyof TableColumns)[] = [
            "tgid", "name", "language", "voice", "chorister", "manager", "admin", "ex_chorister",
            "accountant", "conductor"];

        columns.forEach((name, idx) => {
            const column = names.find(n => n.toLowerCase() === name.toLowerCase());
            if (column) {
                info[column] = idx;
            }
        })

        for (const name of names) {
            if (info[name] === undefined) {
                return Expected.err(`No '${name}' column found`);
            }
        }
        return Expected.ok(info as TableColumns);
    } catch (e) {
        return Expected.exception("error", e);
    }
}

function get_voice(voice: string): Voice {
    switch (voice.toLowerCase()) {
        case "alto": return Voice.Alto;
        case "soprano": return Voice.Soprano;
        case "tenor": return Voice.Tenor;
        case "baritone": return Voice.Baritone;
        default: return Voice.Unknown;
    }
}

function get_roles(row: string[], columns: TableColumns): Role[] {
    const roles: Role[] = [];
    if (row[columns.chorister]?.toLowerCase() === "true") {
        roles.push(Role.Chorister);
    }
    if (row[columns.manager]?.toLowerCase() === "true") {
        roles.push(Role.Manager);
    }
    if (row[columns.admin]?.toLowerCase() === "true") {
        roles.push(Role.Admin);
    }
    if (row[columns.ex_chorister]?.toLowerCase() === "true") {
        roles.push(Role.ExChorister);
    }
    if (row[columns.accountant]?.toLowerCase() === "true") {
        roles.push(Role.Accountant);
    }
    if (row[columns.conductor]?.toLowerCase() === "true") {
        roles.push(Role.Conductor);
    }
    return roles;
}

function get_language(lang: string): Language {
    switch (lang.toLowerCase()) {
        case "ru": return Language.RU;
        case "eng": return Language.EN;
        default: return Language.EN;
    }
}

function try_parse_row(row: string[], columns: TableColumns): Expected<User> {
    try {
        const tgid = row[columns.tgid];
        if (!tgid || tgid.length === 0) {
            return Expected.err("No 'tgid' column found");
        }

        const [name, surname] = row[columns.name].split(" ");
        const lang = get_language(row[columns.language]);
        const voice = get_voice(row[columns.voice]);
        const roles = get_roles(row, columns);

        const user = new User(tgid, name, surname, lang, voice, roles);
        return Expected.ok(user);
    } catch (e) {
        return Expected.exception("error", e);
    }
}

export class UsersFetcher {
    private last_fetch_date?: Date;
    private sheet: GoogleSpreadsheet;
    private journal: Journal;

    constructor(
        private readonly config: UsersFetcherConfig,
        private database: Database,
        parent_journal: Journal
    ) {
        this.sheet = new GoogleSpreadsheet(this.config.google_sheet_id);
        this.journal = parent_journal.child("users_fetcher");
    }

    async start(): Promise<Status> {
        return await this.proceed();
    }

    async proceed(): Promise<Status> {
        if (!this.time_to_fetch()) {
            return Expected.ok(undefined);
        }

        const sheet_status = await this.sheet.read(this.config.range);
        if (!sheet_status.ok) {
            return sheet_status.wrap_error("can't fetch sheet data");
        }
        const table = sheet_status.value!;
        if (table.length < 2) {
            return Expected.ok(undefined); // Just no any data (or header only), not an error
        }

        const header_status = try_parse_header(table[0]);
        if (!header_status.ok) {
            return header_status.wrap_error("invalid header");
        }
        const columns = header_status.value!;

        const users: User[] = []
        table.slice(1).forEach((row, idx) => {
            const status = try_parse_row(row, columns);
            if (!status.ok) {
                this.journal.log().error(`Error parsing user '${row[columns.tgid]}' at row ${idx}: ${status.error}`);
            } else {
                users.push(status.value!);
            }
        });

        users.forEach((user) => this.update_database(user));
        return Expected.ok(undefined);
    }

    private update_database(user: User): void {
        const existing_user = this.database.get_user(user.tgid);
        if (existing_user == undefined) {
            this.database.add_user(user);
        } else {
            const diffs = existing_user.update(user);
            if (diffs.length > 0) {
                this.journal.log().info(`Updated user ${user.tgid}: ${diffs.join(", ")}`);
            }
        }
    }

    // Check if it is time to fetch data since previous check.
    // NOTE: if function returns true, last_fetch_date is set to current time.
    private time_to_fetch(): boolean {
        const now_ms = new Date().getTime();
        if (!this.last_fetch_date) {
            this.last_fetch_date = new Date();
            return true;
        }
        const fetch_interval_ms = this.config.fetch_interval_sec * 1000;
        const time_since_last_fetch = now_ms - this.last_fetch_date.getTime();
        if (time_since_last_fetch < fetch_interval_ms) {
            return false;
        }
        this.last_fetch_date = new Date();
        return true;
    }
}