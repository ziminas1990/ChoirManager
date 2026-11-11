import { GoogleSpreadsheet } from "@src/api/google_docs.js";
import { Language, Role, UserData, Voice } from "@src/entities/user.js";
import { IJournal } from "@src/interfaces/journal.js";
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

function role_is_set(row: string[], index: number): boolean {
    const cell = row[index];
    return typeof cell === "string" && cell.toLowerCase() === "true";
}

function get_roles(row: string[], columns: TableColumns): Role[] {
    const roles: Role[] = [];
    if (role_is_set(row, columns.chorister)) {
        roles.push(Role.Chorister);
    }
    if (role_is_set(row, columns.manager)) {
        roles.push(Role.Manager);
    }
    if (role_is_set(row, columns.admin)) {
        roles.push(Role.Admin);
    }
    if (role_is_set(row, columns.ex_chorister)) {
        roles.push(Role.ExChorister);
    }
    if (role_is_set(row, columns.accountant)) {
        roles.push(Role.Accountant);
    }
    if (role_is_set(row, columns.conductor)) {
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

export type UsersSheetRowError = {
    // 1-based position inside the fetched range. Row 1 is the header.
    row: number;
    tgid: string;
    message: string;
};

export type UsersSheetRead = {
    rows: UserData[];
    errors: UsersSheetRowError[];
};

function try_parse_row(row: string[], columns: TableColumns): Expected<UserData> {
    const tgid = row[columns.tgid];
    if (typeof tgid !== "string" || tgid.length === 0) {
        return Expected.err(typeof tgid === "string" ? "tgid is empty" : "tgid must be text");
    }

    const name_cell = row[columns.name];
    if (typeof name_cell !== "string" || name_cell.length === 0) {
        return Expected.err("name is empty");
    }
    const [name, surname] = name_cell.split(" ");

    const language_cell = row[columns.language];
    if (typeof language_cell !== "string") {
        return Expected.err("language must be text");
    }
    const voice_cell = row[columns.voice];
    if (typeof voice_cell !== "string") {
        return Expected.err("voice must be text");
    }

    // Sheets only know telegram ids; system_id is filled by a higher layer.
    // tgid is kept verbatim so later deposit links still match.
    const user: UserData = {
        id: {
            system_id: "",
            tg_username: tgid,
        },
        name,
        surname: surname ?? "",
        lang: get_language(language_cell),
        voice: get_voice(voice_cell),
        roles: get_roles(row, columns),
    };
    return Expected.ok(user);
}

// A bad header is a read failure. A bad data row is returned in errors
// together with the rows that parsed.
export function parse_users_table(table: string[][]): Expected<UsersSheetRead> {
    if (table.length === 0) {
        return Expected.ok({ rows: [], errors: [] });
    }

    const header_status = try_parse_header(table[0]);
    if (!header_status.ok) {
        return header_status.wrap_error("invalid header");
    }
    const columns = header_status.value;

    const rows: UserData[] = [];
    const errors: UsersSheetRowError[] = [];
    for (let index = 1; index < table.length; index++) {
        const row = table[index];
        if (!Array.isArray(row)) {
            errors.push({
                row: index + 1,
                tgid: "",
                message: "row is not a list of cells",
            });
            continue;
        }
        const status = try_parse_row(row, columns);
        if (!status.ok) {
            const tgid_cell = row[columns.tgid];
            errors.push({
                row: index + 1,
                tgid: typeof tgid_cell === "string" ? tgid_cell : "",
                message: status.error,
            });
            continue;
        }
        rows.push(status.value);
    }
    return Expected.ok({ rows, errors });
}

// Sheet parser kept for the users-collection migration tool.
// Not used by production UserService.
export class GoogleSpreadsheetUsersStorage {
    private sheet: GoogleSpreadsheet;
    private journal: IJournal;

    constructor(private readonly config: Config, parent_journal: IJournal) {
        this.sheet = new GoogleSpreadsheet(this.config.google_sheet_id);
        this.journal = parent_journal.child("users_storage");
    }

    async fetch_all(): Promise<Expected<UsersSheetRead>> {
        const sheet_status = await this.sheet.read(this.config.range);
        if (!sheet_status.ok) {
            return sheet_status.wrap_error("can't fetch sheet data");
        }

        const parsed = parse_users_table(sheet_status.value);
        if (!parsed.ok) {
            return parsed;
        }
        for (const error of parsed.value.errors) {
            const who = error.tgid.length > 0 ? error.tgid : "(blank)";
            this.journal.error(
                `Error parsing user '${who}' at row ${error.row}: ${error.message}`);
        }
        return parsed;
    }
}
