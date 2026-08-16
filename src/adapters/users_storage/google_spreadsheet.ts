import { GoogleSpreadsheet } from "@src/api/google_docs.js";
import { Language, Role, UserData, Voice } from "@src/entities/user.js";
import { Journal } from "@src/journal.js";
import { Expected } from "@src/utils/expected.js";

export type Config = {
    google_sheet_id: string;
    range: string;
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

function try_parse_row(row: string[], columns: TableColumns): Expected<UserData> {
    try {
        const tgid = row[columns.tgid];
        if (!tgid || tgid.length === 0) {
            return Expected.err("No 'tgid' column found");
        }

        const [name, surname] = row[columns.name].split(" ");
        const lang = get_language(row[columns.language]);
        const voice = get_voice(row[columns.voice]);
        const roles = get_roles(row, columns);

        // Sheets only know telegram ids; system_id is filled by a higher layer.
        const user: UserData = {
            id: {
                system_id: "",
                tg_username: tgid,
            },
            name,
            surname,
            lang,
            voice,
            roles,
        };
        return Expected.ok(user);
    } catch (e) {
        return Expected.exception("error", e);
    }
}

// Sheet parser kept for the users-collection migration tool.
// Not used by production UserService.
export class GoogleSpreadsheetUsersStorage {
    private sheet: GoogleSpreadsheet;
    private journal: Journal;

    constructor(private readonly config: Config, parent_journal: Journal) {
        this.sheet = new GoogleSpreadsheet(this.config.google_sheet_id);
        this.journal = parent_journal.child("users_storage");
    }

    async fetch_all(): Promise<UserData[]> {
        const sheet_status = await this.sheet.read(this.config.range);
        if (!sheet_status.ok) {
            throw new Error(sheet_status.wrap_error("can't fetch sheet data").error);
        }
        const table = sheet_status.value;
        if (table.length < 2) {
            // Header only or empty sheet — not an error.
            return [];
        }

        const header_status = try_parse_header(table[0]);
        if (!header_status.ok) {
            throw new Error(header_status.wrap_error("invalid header").error);
        }
        const columns = header_status.value;

        const users: UserData[] = [];
        table.slice(1).forEach((row, idx) => {
            const status = try_parse_row(row, columns);
            if (!status.ok) {
                this.journal.log().error(
                    `Error parsing user '${row[columns.tgid]}' at row ${idx}: ${status.error}`);
            } else {
                users.push(status.value);
            }
        });

        return users;
    }
}
