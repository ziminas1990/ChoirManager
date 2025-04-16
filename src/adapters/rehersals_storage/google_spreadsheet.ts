import { GoogleSpreadsheet } from "@src/api/google_docs.js";
import { IRehersalsStorage, RehersalInfo } from "@src/interfaces/rehersals_storage.js";
import { Status, StatusWith } from "@src/status.js";

// Assuming the date format is DD.MM.YY
function parse_date(date: string): Date | undefined {
    const parts = date.split('.');
    if (parts.length != 3) {
        return undefined;
    }
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1; // Months are zero-indexed in JS
    let year = parseInt(parts[2], 10); // Assuming the year is in the 2000s
    if (year < 2000) {
        year += 2000;
    }
    const date_js = new Date(Date.UTC(year, month, day));
    return date_js;
}

export type Config = {
    spreadsheet_id: string
    sheet_name: string
}

type UserRow = {
    row_id: number,
    tgid: string,
    name: string,
    joined: Date,
    // key is column index
    minutes: Map<number, number>
}

type SongRow = {
    row_id: number,
    name: string,
    // key is column index
    minutes: Map<number, number>
}

type Row = {
    user?: UserRow,
    song?: SongRow,
}

type RehersalColumn = {
    column_id: number,
    date: Date,
}

type TableColumns = {
    tag: number,
    joined: number,
    tgid: number,
    who: number,
}

function try_parse_header(header: string[]): StatusWith<TableColumns> {
    const columns = header.map(h => h.toLowerCase().trim());

    const info: Partial<TableColumns> = {}
    const names: (keyof TableColumns)[] = ["tag", "joined", "tgid", "who"];

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

function get_rehersals_columns(header: string[]): RehersalColumn[] {
    const rehersals_columns: RehersalColumn[] = [];
    for (let i = 0; i < header.length; i++) {
        const date = parse_date(header[i]);
        if (date) {
            rehersals_columns.push({ column_id: i, date });
        }
    }
    return rehersals_columns;
}

function try_parse_user_row(row_id: number, row: string[], columns: TableColumns)
: Row | undefined
{
    let tag = row[columns.tag].toLowerCase();
    if (tag.startsWith("ex-")) {
        tag = tag.slice(3);
    }
    const voices = ["soprano", "alto", "tenor", "bass"];

    const first_rehersal_column = Math.max(
        columns.tag, columns.joined, columns.tgid, columns.who,
    ) + 1;

    if (voices.includes(tag)) {
        // This is a row with chorister
        const tgid = row[columns.tgid];
        const name = row[columns.who];
        const joined = parse_date(row[columns.joined]);
        if (!joined) {
            return undefined;
        }
        const minutes = new Map<number, number>();
        for (let i = first_rehersal_column; i < row.length; i++) {
            const hours = parseInt(row[i]);
            if (hours > 0) {
                minutes.set(i, hours * 60);
            }
        }
        return {
            user: { row_id, tgid, name, joined, minutes },
        }
    } else if (tag == "song") {
        const name = row[columns.who];
        const minutes = new Map<number, number>();
        for (let i = first_rehersal_column; i < row.length; i++) {
            const song_minutes = parseInt(row[i]);
            if (song_minutes > 0) {
                minutes.set(i, song_minutes);
            }
        }
        return {
            song: { row_id, name, minutes },
        }
    }
    return undefined;
}

export class GoogleSpreadsheetRehersalsStorage implements IRehersalsStorage {
    private sheet: GoogleSpreadsheet;

    constructor(private config: Config) {
        this.sheet = new GoogleSpreadsheet(config.spreadsheet_id)
    }

    async init(): Promise<Status> {
        return Status.ok();
    }

    async fetch(): Promise<StatusWith<RehersalInfo[]>> {
        const sheet_status = await this.sheet.read(`${this.config.sheet_name}`);
        if (!sheet_status.ok()) {
            return sheet_status.wrap("can't fetch sheet data");
        }
        const table = sheet_status.value!;

        const columns = try_parse_header(table[0]);
        if (!columns.ok()) {
            return columns.wrap("invalid header");
        }

        const rehersals_columns = get_rehersals_columns(table[0]);

        const rows: Row[] = [];
        table.slice(1).forEach((row, row_id) => {
            const row_status = try_parse_user_row(row_id, row, columns.value!);
            if (row_status) {
                rows.push(row_status);
            }
        });

        const rehersals: RehersalInfo[] = [];
        for (const rehersal_column of rehersals_columns) {
            const rehersal_info: RehersalInfo = {
                date: rehersal_column.date,
                songs: [],
                participants: [],
            }
            for (const row of rows) {
                if (row.user) {
                    const minutes = row.user.minutes.get(rehersal_column.column_id);
                    if (minutes) {
                        rehersal_info.participants.push({
                            tgid: row.user.tgid,
                            minutes,
                        });
                    }
                }
                if (row.song) {
                    const minutes = row.song.minutes.get(rehersal_column.column_id);
                    if (minutes) {
                        rehersal_info.songs.push({
                            name: row.song.name,
                            minutes,
                        });
                    }
                }
            }
            rehersals.push(rehersal_info);
        }
        return StatusWith.ok().with(rehersals);
    }
}
