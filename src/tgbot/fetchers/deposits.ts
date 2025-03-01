import * as fs from 'fs';
import { Auth, google, sheets_v4 } from 'googleapis';
import { Status, StatusWith } from '../../status.js';

// Assuming the date format is DD.MM.YY
function parse_date(date: string): Date {
    const parts = date.split('.');
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1; // Months are zero-indexed in JS
    const year = parseInt(parts[2], 10); // Assuming the year is in the 2000s
    const date_js = new Date(year, month, day);
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

        const dates: Set<number> = new Set();
        [...prev.membership.keys(), ...next.membership.keys()].forEach((date) => dates.add(date));
        for (const date of dates) {
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

function try_parse_row(row: string[], months: Date[]): Deposit | undefined {
    const [tgid, chorister, credit_str, debit_str, ...membership] = row;
    if (!tgid || tgid.length === 0) {
        return undefined;
    }

    const credit  = credit_str ? Math.abs(parseInt(credit_str)) : 0;
    const debit   = debit_str ? parseInt(debit_str) : 0;
    const balance = debit - credit;

    const membership_map = new Map<number, number>();
    membership.forEach((amount, month_idx) => {
        if (month_idx >= months.length) {
            return;
        }
        const date = months[month_idx];
        if (date) {
            membership_map.set(date.getTime(), amount ? parseInt(amount) : 0);
        }
    });
    return {
        tgid,
        chorister,
        balance,
        membership: membership_map,
        last_fetch_date: new Date(),
    };
}

function check_header(header: string[]): Status {
    const [tgid, chorister, credit, debit] = header;
    if (tgid.toLowerCase() !== "tgid") {
        return Status.fail("First column must be 'Tgid'");
    }
    if (chorister.toLowerCase() !== "chorister") {
        return Status.fail("Second column must be 'chorister'");
    }
    if (credit.toLowerCase() !== "credit") {
        return Status.fail("Third column must be 'Credit'");
    }
    if (debit.toLowerCase() !== "debit") {
        return Status.fail("Fourth column must be 'Debit'");
    }
    return Status.ok();
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
        const fetch_interval_ms = 10 * 1000;

        if (this.last_fetch_date && now_ms - this.last_fetch_date.getTime() < fetch_interval_ms) {
            return Status.ok().with(this.choristers);
        }
        this.last_fetch_date = new Date();

        console.log("Refetching deposits");

        const sheet_id = "1F-ZlOD8ags8A-r40V700qBCbJrXTG07Dbet9wFmWtYc";
        const sheet = await this.sheets!.spreadsheets.values.get({
            spreadsheetId: sheet_id,
            range: "A:G"
        });
        if (!sheet.data.values) {
            return Status.fail("can't fetch sheet data");
        }

        const header = sheet.data.values[0];
        const header_status = check_header(header);
        if (!header_status.ok()) {
            return header_status.wrap("invalid header");
        }

        const [, , , , ...months] = header;
        const months_dates = months.map(parse_date);

        const deposits = sheet.data.values.slice(1).map((row) => try_parse_row(row, months_dates));

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
