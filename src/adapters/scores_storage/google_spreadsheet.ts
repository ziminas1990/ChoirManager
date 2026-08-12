import { GoogleSpreadsheet } from "@src/api/google_docs.js";
import { Score } from "@src/entities/score.js";
import { IScoresStorage } from "@src/interfaces/storage/scores_storage.js";
import { Journal } from "@src/journal.js";
import { Expected } from "@src/utils/expected.js";

export type Config = {
    google_sheet_id: string;
    range: string;
}

type TableColumns = {
    name: number;
    author: number;
    hints: number;
    duration: number;
    file: number;
}

function try_parse_header(header: string[]): Expected<TableColumns> {
    const columns = header.map(h => h.toLowerCase().trim());

    const info: Partial<TableColumns> = {};
    const names: (keyof TableColumns)[] = ["name", "author", "hints", "duration", "file"];

    columns.forEach((name, idx) => {
        const column = names.find(n => n === name);
        if (column) {
            info[column] = idx;
        }
    });

    for (const name of names) {
        if (info[name] === undefined) {
            return Expected.err(`No '${name}' column found`);
        }
    }
    return Expected.ok(info as TableColumns);
}

function try_parse_row(row: string[], columns: TableColumns): Expected<Score> {
    const name = row[columns.name];
    if (!name) {
        return Expected.err("no name found");
    }
    const author = row[columns.author];
    if (!author) {
        return Expected.err(`no author found for ${name}`);
    }
    const hints = row[columns.hints] ?? "";
    const duration = parseInt(row[columns.duration] ?? "0");
    const file = row[columns.file] || undefined;
    return Expected.ok(new Score(name, author, hints, duration, file));
}

export class GoogleSpreadsheetScoresStorage implements IScoresStorage {
    private sheet: GoogleSpreadsheet;
    private journal: Journal;

    constructor(private readonly config: Config, parent_journal: Journal) {
        this.sheet = new GoogleSpreadsheet(this.config.google_sheet_id);
        this.journal = parent_journal.child("scores_storage");
    }

    async fetch_all(): Promise<Expected<Score[]>> {
        const sheet_status = await this.sheet.read(this.config.range);
        if (!sheet_status.ok) {
            return sheet_status.wrap_error("can't fetch sheet data");
        }
        const table = sheet_status.value;
        if (table.length < 2) {
            // Header only or empty sheet — not an error.
            return Expected.ok([]);
        }

        const header_status = try_parse_header(table[0]);
        if (!header_status.ok) {
            return header_status.wrap_error("invalid header");
        }
        const columns = header_status.value;

        const scores: Score[] = [];
        for (const row of table.slice(1)) {
            const parsed = try_parse_row(row, columns);
            if (!parsed.ok) {
                this.journal.log().warn(`Skipping scores row: ${parsed.error}`);
                continue;
            }
            scores.push(parsed.value);
        }

        return Expected.ok(scores);
    }
}
