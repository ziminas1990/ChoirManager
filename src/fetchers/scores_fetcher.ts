import { Status, StatusWith } from '@src/status.js';
import { Config } from '@src/config.js';
import { GoogleSpreadsheet } from '@src/api/google_docs.js';
import { Database, Scores } from '@src/database.js';

type TableColumns = {
    name: number,
    author: number,
    hints: number,
    duration: number,
    file: number,
}

function try_parse_header(header: string[]): StatusWith<TableColumns> {
    const columns = header.map(h => h.toLowerCase().trim());

    const info: Partial<TableColumns> = {}
    const names: (keyof TableColumns)[] = ["name","author", "hints", "duration", "file"];

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

function try_parse_row(row: string[], columns: TableColumns): StatusWith<Scores> {
    const name = row[columns.name];
    if (!name) {
        return StatusWith.fail("no name found");
    }
    const author = row[columns.author];
    if (!author) {
        return StatusWith.fail(`no author found for ${name}`);
    }
    const hints = row[columns.hints] ?? "";
    const duration = parseInt(row[columns.duration] ?? "0");
    const file = row[columns.file];
    const scores = new Scores(name, author, hints, duration, file);
    return StatusWith.ok().with(scores);
}

export class ScoresFetcher {
    private last_fetch_date?: Date;
    private sheet: GoogleSpreadsheet;

    constructor(private database: Database) {
        this.sheet = new GoogleSpreadsheet(Config.ScoresFetcher().google_sheet_id)
    }

    async start(): Promise<Status> {
        return await this.proceed();
    }

    async proceed(): Promise<Status> {
        if (!this.time_to_fetch()) {
            return Status.ok();
        }

        const sheet_status = await this.sheet.read(Config.ScoresFetcher().range);
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

    private update_database(scores: Scores): void {
        const existing_scores = this.database.find_scores(scores);
        if (existing_scores == undefined) {
            this.database.add_scores(scores);
        } else {
            const diffs = existing_scores.update(scores);
            if (diffs.length > 0) {
                console.log(`Updated scores ${scores.get_key()}: ${diffs.join(", ")}`);
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
        const fetch_interval_ms = Config.ScoresFetcher().fetch_interval_sec * 1000;
        const time_since_last_fetch = now_ms - this.last_fetch_date.getTime();
        if (time_since_last_fetch < fetch_interval_ms) {
            return false;
        }
        this.last_fetch_date = new Date();
        return true;
    }
}