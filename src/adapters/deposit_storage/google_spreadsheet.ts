import { GoogleSpreadsheet } from "@src/api/google_docs.js";
import { Deposit } from "@src/entities/deposit.js";
import { IDepositStorage } from "@src/interfaces/storage/deposit_storage.js";
import { Journal } from "@src/journal.js";
import { only_month } from "@src/utils.js";
import { Expected } from "@src/utils/expected.js";

export type Config = {
    google_sheet_id: string;
    range: string;
}

type TableColumns = {
    tgid: number;
    chorister: number;
    credit: number;
    debit: number;
    // timestamp -> column index
    months: Map<number, number>;
}

// Assuming the date format is DD.MM.YY
function try_parse_date(date: string): Date | undefined {
    const parts = date.split(".");
    if (parts.length < 3) {
        return undefined;
    }

    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    let year = parseInt(parts[2], 10);

    if (isNaN(day) || isNaN(month) || isNaN(year)) {
        return undefined;
    }
    if (day < 1 || day > 31 || month < 0 || month > 11 || year < 0) {
        return undefined;
    }
    if (year < 100) {
        year += 2000;
    }

    const date_js = new Date(Date.UTC(year, month, day));
    if (isNaN(date_js.getTime())) {
        return undefined;
    }
    return date_js;
}

function try_parse_header(header: string[]): Expected<TableColumns> {
    const columns = header.map(h => h.toLowerCase().trim());

    // Minimum: tgid, chorister, credit, debit, and at least 1 month
    if (columns.length < 5) {
        return Expected.err("Header must contain at least 5 columns");
    }

    const info: Partial<TableColumns> = {};
    const months = new Map<number, number>();

    columns.forEach((name, idx) => {
        switch (name) {
            case "tgid":
                info.tgid = idx;
                break;
            case "chorister":
                info.chorister = idx;
                break;
            case "credit":
                info.credit = idx;
                break;
            case "debit":
                info.debit = idx;
                break;
            case "":
                break;
            default: {
                const date = try_parse_date(name);
                if (date) {
                    const month_date = only_month(date);
                    months.set(month_date.getTime(), idx);
                }
            }
        }
    });

    if (info.tgid === undefined) {
        return Expected.err("No 'tgid' column found");
    }
    if (info.chorister === undefined) {
        return Expected.err("No 'chorister' column found");
    }
    if (info.credit === undefined) {
        return Expected.err("No 'credit' column found");
    }
    if (info.debit === undefined) {
        return Expected.err("No 'debit' column found");
    }
    if (months.size === 0) {
        return Expected.err("No valid month columns found");
    }

    return Expected.ok({
        tgid: info.tgid,
        chorister: info.chorister,
        credit: info.credit,
        debit: info.debit,
        months,
    });
}

function try_parse_row(row: string[], columns: TableColumns): Deposit | undefined {
    const tgid = row[columns.tgid];
    if (!tgid || tgid.length === 0) {
        return undefined;
    }

    const chorister = row[columns.chorister];
    const credit_str = row[columns.credit];
    const debit_str = row[columns.debit];

    const credit = credit_str ? Math.abs(parseInt(credit_str)) : 0;
    const debit = debit_str ? parseInt(debit_str) : 0;
    const balance = debit - credit;

    const membership_map = new Map<number, number>();
    for (const [date, col_idx] of columns.months) {
        const amount = row[col_idx] ?? "0";
        membership_map.set(date, parseInt(amount) || 0);
    }

    return new Deposit(tgid, chorister, balance, membership_map);
}

export class GoogleSpreadsheetDepositStorage implements IDepositStorage {
    private sheet: GoogleSpreadsheet;
    private journal: Journal;

    constructor(private readonly config: Config, parent_journal: Journal) {
        this.sheet = new GoogleSpreadsheet(this.config.google_sheet_id);
        this.journal = parent_journal.child("deposit_storage");
    }

    async fetch_all(): Promise<Deposit[]> {
        const sheet_status = await this.sheet.read(this.config.range);
        if (!sheet_status.ok) {
            const wrapped = sheet_status.wrap_error("can't fetch sheet data");
            this.journal.log().error(wrapped.error);
            throw new Error(wrapped.error);
        }
        const table = sheet_status.value;
        if (table.length < 2) {
            // Header only or empty sheet — not an error.
            return [];
        }

        const header_status = try_parse_header(table[0]);
        if (!header_status.ok) {
            const wrapped = header_status.wrap_error("invalid header");
            this.journal.log().error(wrapped.error);
            throw new Error(wrapped.error);
        }
        const columns = header_status.value;

        const deposits: Deposit[] = [];
        for (const row of table.slice(1)) {
            const deposit = try_parse_row(row, columns);
            if (deposit) {
                deposits.push(deposit);
            }
        }

        return deposits;
    }
}
