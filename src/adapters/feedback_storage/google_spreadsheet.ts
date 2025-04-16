import { GoogleSpreadsheet } from "@src/api/google_docs.js";
import { Voice } from "@src/database.js";
import { Feedback } from "@src/entities/feedback.js";
import { IFeedbackStorage } from "@src/interfaces/feedback_storage.js";
import { Journal } from "@src/journal.js";
import { Status, StatusWith } from "@src/status.js";
import { log_and_return } from "@src/utils.js";

export type Config = {
    spreadsheet_id: string
    sheet_name: string
}

type TableColumns = {
    timestamp: number,
    date: number,
    who: number,
    tgid: number,
    voice: number,
    details: number
}

function try_parse_header(header: string[]): StatusWith<TableColumns> {
    const columns = header.map(h => h.toLowerCase().trim());

    const info: Partial<TableColumns> = {}
    const names: (keyof TableColumns)[] = ["timestamp", "date", "who", "tgid", "voice", "details"];

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

function get_voice(voice: string): Voice | undefined {
    switch (voice.toLowerCase()) {
        case "alto": return Voice.Alto;
        case "soprano": return Voice.Soprano;
        case "tenor": return Voice.Tenor;
        case "baritone": return Voice.Baritone;
        default: return undefined;
    }
}

function try_parse_row(row: string[], columns: TableColumns): StatusWith<Feedback> {

    const timestamp = row[columns.timestamp];
    if (!timestamp || timestamp.length === 0) {
        return StatusWith.fail("No 'timestamp' column found");
    }

    const tgid = row[columns.tgid] || undefined;
    const name_surname = row[columns.who] || undefined;

    const date = new Date(timestamp);
    const who = (tgid) ? {
        tgid: tgid,
        name_surname: name_surname || "unknown"
    } : undefined;
    const voice = row[columns.voice];
    const details = row[columns.details];

    const feedback: Feedback = {
        date,
        details,
        who,
        voice: get_voice(voice)
    };

    return StatusWith.ok().with(feedback);
}

export class GoogleSpreadsheetFeedbackStorage implements IFeedbackStorage {
    private sheet: GoogleSpreadsheet;
    private feedbacks: Feedback[] = [];
    private journal: Journal;

    constructor(private config: Config, parent_journal: Journal) {
        this.sheet = new GoogleSpreadsheet(config.spreadsheet_id)
        this.journal = parent_journal.child("feedback_storage");
    }

    async init(): Promise<Status> {
        return await this.load_feedbacks();
    }

    async get_feedbacks(): Promise<StatusWith<Feedback[]>> {
        return Status.ok().with(this.feedbacks);
    }

    async add_feedback(feedback: Feedback): Promise<Status> {
        // Add feedback to the local array
        this.feedbacks.push(feedback);

        // Prepare the row to be added to the Google Spreadsheet
        const row = [
            feedback.date.getTime(),
            feedback.date.toISOString(),
            feedback.who?.name_surname || "",
            feedback.who?.tgid || "",
            feedback.voice || "",
            feedback.details
        ];

        // Add the row to the Google Spreadsheet
        const add_status = await this.sheet.append(
            `${this.config.sheet_name}!A:F`, row.map(String));
        if (!add_status.ok()) {
            return log_and_return(
                add_status.wrap("failed to add feedback to the spreadsheet"),
                this.journal.log()
            );
        }
        return Status.ok();
    }

    private async load_feedbacks(): Promise<Status> {
        const sheet_status = await this.sheet.read(`${this.config.sheet_name}!A:F`);
        if (!sheet_status.ok()) {
            return sheet_status.wrap("can't fetch sheet data");
        }
        const table = sheet_status.value!;
        const columns = try_parse_header(table[0]);
        if (!columns.ok()) {
            return columns.wrap("invalid header");
        }

        this.feedbacks = [];
        let invalid_rows = 0;
        let row_number = 0;
        for (const row of table.slice(1)) {
            row_number++;
            const feedback_status = try_parse_row(row, columns.value!);
            if (!feedback_status.ok()) {
                this.journal.log().error(`Invalid row #${row_number}: ${feedback_status.what()}`);
                invalid_rows++;
                continue;
            }
            this.feedbacks.push(feedback_status.value!);
        }

        if (invalid_rows > 0) {
            this.journal.log().warn(`got ${invalid_rows} invalid rows`);
        }
        return Status.ok();
    }
}
