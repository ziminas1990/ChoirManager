import * as fs from 'fs';
import { Auth, google, sheets_v4 } from 'googleapis';
import { Status, StatusWith } from '../../status.js';
import { Config } from '../config.js';

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
        public readonly membership: Map<number, number>,
        public readonly last_fetch_date: Date,
    ) {}

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
                const month = try_parse_date(name);
                if (month) {
                    months.set(month.getTime(), idx);
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

    return {
        tgid,
        chorister,
        balance,
        membership: membership_map,
        last_fetch_date: new Date(),
    };
}

export class DepositsFetcher {
    private last_fetch_date?: Date;
    private choristers: Map<string, Deposit> = new Map();

    private auth?: Auth.GoogleAuth;
    private sheets?: sheets_v4.Sheets;

    constructor() {}

    async start(google_could_file: string): Promise<Status> {
        const auth_status = DepositsFetcher.authenticate(google_could_file);
        if (!auth_status.ok()) {
            return auth_status.wrap("Failed to authenticate");
        }
        this.auth   = auth_status.value!;
        this.sheets = google.sheets({ version: "v4", auth: this.auth });
        return this.proceed();
    }

    get_user_deposit(tg_id: string): Deposit | undefined {
        return this.choristers.get(tg_id);
    }

    async proceed(): Promise<Status> {
        const now_ms            = new Date().getTime();
        const fetch_interval_ms = Config.DepositTracker().fetch_interval_sec * 1000;

        if (this.last_fetch_date && now_ms - this.last_fetch_date.getTime() < fetch_interval_ms) {
            return Status.ok().with(this.choristers);
        }
        this.last_fetch_date = new Date();

        const sheet_id = Config.DepositTracker().google_sheet_id;
        const sheet = await this.sheets!.spreadsheets.values.get({
            spreadsheetId: sheet_id,
            range: "A:K"
        });
        if (!sheet.data.values) {
            return Status.fail("can't fetch sheet data");
        }

        const header = sheet.data.values[0];
        const header_status = try_parse_header(header);
        if (!header_status.ok()) {
            return header_status.wrap("invalid header");
        }
        const columns = header_status.value!;

        const deposits = sheet.data.values.slice(1)
            .map(row => try_parse_row(row, columns));

        deposits.forEach((deposit) => {
            if (deposit && deposit.tgid) {
                this.choristers.set(deposit.tgid, deposit);
            }
        });
        return Status.ok();
    }

    private static authenticate(google_could_file: string): StatusWith<Auth.GoogleAuth> {
        let credentials: any | undefined = undefined;
        try {
            credentials = JSON.parse(fs.readFileSync(google_could_file, "utf8"));
        } catch (error) {
            return Status.fail(`Failed to load credentials: ${error}`);
        }
        if (!credentials) {
            return Status.fail("Failed to load credentials");
        }

        const auth = new google.auth.GoogleAuth({
            credentials: credentials,
            scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
        });
        return Status.ok().with(auth);
    }
}
