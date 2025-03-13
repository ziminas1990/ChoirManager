import { Status, StatusWith } from '../../status.js';
import { Config } from '../config.js';
import { GoogleSpreadsheet } from '../api/google_docs.js';
import { current_month, only_month } from '../utils.js';

// Assuming the date format is DD.MM.YY
function try_parse_date(date: string): Date | undefined {
    const parts = date.split('.');
    if (parts.length < 3) {
        return undefined;
    }

    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1; // Months are zero-indexed in JS
    let   year = parseInt(parts[2], 10); // Assuming the year is in the 2000s

    // Check if parts are valid numbers
    if (isNaN(day) || isNaN(month) || isNaN(year)) {
        return undefined;
    }

    // Check if date is valid
    if (day < 1 || day > 31 || month < 0 || month > 11 || year < 0) {
        return undefined;
    }
    if (year < 100) {
        year += 2000;
    }

    const date_js = new Date(Date.UTC(year, month, day));
    // Check if date is valid (handles cases like 31.04.YY)
    if (isNaN(date_js.getTime())) {
        return undefined;
    }
    return date_js;
}

export type DepositChange = {
    balance?: [number, number];
    membership?: [Date, number, number][];
}

export class Deposit {
    constructor(
        public readonly tgid: string,
        public readonly chorister: string,
        public readonly balance: number,
        public readonly membership: Map<number, number>)
    {}

    // Balance + paid membership for current month
    current_month_balance(): number {
        return (this.membership.get(current_month().getTime()) ?? 0) + this.balance;
    }

    static diff(prev: Deposit, next: Deposit): DepositChange | undefined {
        const changes: DepositChange = {};
        if (prev.tgid !== next.tgid) {
            return undefined;
        }
        if (prev.balance !== next.balance) {
            changes.balance = [prev.balance, next.balance];
        }

        const last_three_month = [...next.membership.keys()].sort((a, b) => b - a).slice(0, 3);

        for (const date of last_three_month) {
            const prev_amount = prev.membership.get(date) ?? 0;
            const next_amount = next.membership.get(date) ?? 0;
            if (prev_amount !== next_amount) {
                if (changes.membership == undefined) {
                    changes.membership = [];
                }
                changes.membership.push([new Date(date), prev_amount, next_amount]);
            }
        }
        return Object.keys(changes).length > 0 ? changes : undefined;
    }
}

type TableColumns = {
    tgid: number,
    chorister: number,
    credit: number,
    debit: number,
    months: Map<number, number> // timestamp -> column index
}

function try_parse_header(header: string[]): StatusWith<TableColumns> {
    const columns = header.map(h => h.toLowerCase().trim());

    if (columns.length < 5) { // minimum: tgid, chorister, credit, debit, and at least 1 month
        return StatusWith.fail("Header must contain at least 5 columns");
    }

    const info: Partial<TableColumns> = {}
    const months = new Map<number, number>();

    columns.forEach((name, idx) => {
        switch(name) {
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
                break;  // ignoring the column
            default: {
                const date = try_parse_date(name);
                if (date) {
                    const month_date = only_month(date);
                    months.set(month_date.getTime(), idx);
                }
            }
        }
    })

    if (info.tgid === undefined) {
        return StatusWith.fail("No 'tgid' column found");
    }
    if (info.chorister === undefined) {
        return StatusWith.fail("No 'chorister' column found");
    }
    if (info.credit === undefined) {
        return StatusWith.fail("No 'credit' column found");
    }
    if (info.debit === undefined) {
        return StatusWith.fail("No 'debit' column found");
    }
    if (months.size === 0) {
        return StatusWith.fail("No valid month columns found");
    }

    return StatusWith.ok().with({
        tgid: info.tgid,
        chorister: info.chorister,
        credit: info.credit,
        debit: info.debit,
        months: months
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

export class DepositsFetcher {
    private last_fetch_date?: Date;
    private choristers: Map<string, Deposit> = new Map();

    private sheet: GoogleSpreadsheet;

    constructor() {
        this.sheet = new GoogleSpreadsheet(Config.DepositTracker().google_sheet_id)
    }

    async start(): Promise<Status> {
        return this.proceed();
    }

    get_user_deposit(tg_id: string): Deposit | undefined {
        return this.choristers.get(tg_id);
    }

    async proceed(): Promise<Status> {
        if (!this.time_to_fetch()) {
            return Status.ok().with(this.choristers);
        }

        const sheet_status = await this.sheet.read("A:K");
        if (!sheet_status.ok()) {
            return sheet_status.wrap("can't fetch sheet data");
        }
        const table = sheet_status.value!;
        if (table.length < 2) {
            return Status.ok(); // Just no any data (or header only), not an error
        }

        const header = table[0];
        const header_status = try_parse_header(header);
        if (!header_status.ok()) {
            return header_status.wrap("invalid header");
        }
        const columns = header_status.value!;

        const deposits = table.slice(1).map(row => try_parse_row(row, columns));

        deposits.forEach((deposit) => {
            if (deposit && deposit.tgid) {
                this.choristers.set(deposit.tgid, deposit);
            }
        });
        return Status.ok();
    }

    // Check if it is time to fetch data since previous check.
    // NOTE: if function returns true, last_fetch_date is set to current time.
    private time_to_fetch(): boolean {
        const now_ms = new Date().getTime();
        if (!this.last_fetch_date) {
            this.last_fetch_date = new Date();
            return true;
        }
        const fetch_interval_ms = Config.DepositTracker().fetch_interval_sec * 1000;
        const time_since_last_fetch = now_ms - this.last_fetch_date.getTime();
        if (time_since_last_fetch < fetch_interval_ms) {
            return false;
        }
        this.last_fetch_date = new Date();
        return true;
    }
}