import { Status, StatusWith } from '../../status.js';
import { Config } from '../config.js';
import { GoogleSpreadsheet } from '../api/google_docs.js';
import { Database, Language, Role, User, Voice } from '../database.js';

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

function try_parse_header(header: string[]): StatusWith<TableColumns> {
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
            return StatusWith.fail(`No '${name}' column found`);
        }
    }
    return StatusWith.ok().with(info as TableColumns);
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
    if (row[columns.chorister].toLowerCase() === "true") {
        roles.push(Role.Chorister);
    }
    if (row[columns.manager].toLowerCase() === "true") {
        roles.push(Role.Manager);
    }
    if (row[columns.admin].toLowerCase() === "true") {
        roles.push(Role.Admin);
    }
    if (row[columns.ex_chorister].toLowerCase() === "true") {
        roles.push(Role.ExChorister);
    }
    if (row[columns.accountant].toLowerCase() === "true") {
        roles.push(Role.Accountant);
    }
    if (row[columns.conductor].toLowerCase() === "true") {
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

function try_parse_row(row: string[], columns: TableColumns): StatusWith<User> {
    const tgid = row[columns.tgid];
    if (!tgid || tgid.length === 0) {
        return StatusWith.fail("No 'tgid' column found");
    }

    const [name, surname] = row[columns.name].split(" ");
    const lang = get_language(row[columns.language]);
    const voice = get_voice(row[columns.voice]);
    const roles = get_roles(row, columns);

    const user = new User(tgid, name, surname, lang, voice, roles);
    return StatusWith.ok().with(user);
}

export class UsersFetcher {
    private last_fetch_date?: Date;
    private sheet: GoogleSpreadsheet;

    constructor(private database: Database) {
        this.sheet = new GoogleSpreadsheet(Config.UsersFetcher().google_sheet_id)
    }

    async start(): Promise<Status> {
        return await this.proceed();
    }

    async proceed(): Promise<Status> {
        if (!this.time_to_fetch()) {
            return Status.ok();
        }

        const sheet_status = await this.sheet.read("Users!A:K");
        if (!sheet_status.ok()) {
            return sheet_status.wrap("can't fetch sheet data");
        }
        const table = sheet_status.value!;
        if (table.length < 2) {
            return Status.ok(); // Just no any data (or header only), not an error
        }

        const header_status = try_parse_header(table[0]);
        if (!header_status.ok()) {
            return header_status.wrap("invalid header");
        }
        const columns = header_status.value!;

        const users = table.slice(1).map(row => try_parse_row(row, columns));

        users.forEach((user) => {
            if (user.ok()) {
                this.update_database(user.value!);
            }
        });
        return Status.ok();
    }

    private update_database(user: User): void {
        const existing_user = this.database.get_user(user.tgid);
        if (existing_user == undefined) {
            this.database.add_user(user);
        } else {
            const diffs = existing_user.update(user);
            if (diffs.length > 0) {
                console.log(`Updated user ${user.tgid}: ${diffs.join(", ")}`);
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
        const fetch_interval_ms = Config.UsersFetcher().fetch_interval_sec * 1000;
        const time_since_last_fetch = now_ms - this.last_fetch_date.getTime();
        if (time_since_last_fetch < fetch_interval_ms) {
            return false;
        }
        this.last_fetch_date = new Date();
        return true;
    }
}