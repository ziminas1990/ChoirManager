import { Expected, Status } from "@src/utils/expected.js";
import { GoogleSpreadsheet } from '@src/api/google_docs.js';
import { current_month, only_month } from '@src/utils.js';

export type DepositReminderConfigJson = {
    day_of_month: number;
    hour_utc: number;
}

export type DepositAccountConfigJson = {
    title: string;
    account: string;
    receiver?: string;
    comment?: string;
}

export type DepositTrackingConfigJson = {
    google_sheet_id: string;
    fetch_interval_sec: number;
    collect_interval_sec: number;
    membership_fee: number;
    reminders?: DepositReminderConfigJson[];
    reminder_cooldown_hours?: number;
    startup_reminders_freeze_sec?: number;
    accounts?: DepositAccountConfigJson[];
}

export class DepositTrackingConfig {
    constructor(private readonly json: DepositTrackingConfigJson) {}

    get google_sheet_id(): string {
        return this.json.google_sheet_id;
    }

    get fetch_interval_sec(): number {
        return this.json.fetch_interval_sec;
    }

    get collect_interval_sec(): number {
        return this.json.collect_interval_sec;
    }

    get membership_fee(): number {
        return this.json.membership_fee;
    }

    get reminders(): DepositReminderConfigJson[] {
        return this.json.reminders ?? [];
    }

    get reminder_cooldown_hours(): number {
        return this.json.reminder_cooldown_hours ?? 0;
    }

    get startup_reminders_freeze_sec(): number {
        return this.json.startup_reminders_freeze_sec ?? 0;
    }

    get accounts(): DepositAccountConfigJson[] {
        return this.json.accounts ?? [];
    }

    verify(): Status {
        const fail_prefix = "deposit_tracking misconfiguration";

        if (!this.json.google_sheet_id) {
            return Expected.err(`${fail_prefix}: 'google_sheet_id' MUST be specified`);
        }
        if (!this.json.fetch_interval_sec) {
            return Expected.err(`${fail_prefix}: 'fetch_interval_sec' MUST be specified`);
        }
        if (this.json.fetch_interval_sec < 5) {
            return Expected.err(`${fail_prefix}: 'fetch_interval_sec' MUST be at least 5 seconds`);
        }
        if (!this.json.collect_interval_sec) {
            return Expected.err(`${fail_prefix}: 'collect_interval_sec' MUST be specified`);
        }
        if (this.json.collect_interval_sec < 5) {
            return Expected.err(`${fail_prefix}: 'collect_interval_sec' MUST be at least 5 seconds`);
        }
        if (this.json.membership_fee == undefined) {
            return Expected.err(`${fail_prefix}: 'membership_fee' MUST be specified`);
        }
        if (this.json.membership_fee <= 0) {
            return Expected.err(`${fail_prefix}: 'membership_fee' MUST be positive`);
        }
        if (this.json.fetch_interval_sec >= this.json.collect_interval_sec) {
            return Expected.err([
                `${fail_prefix}:`,
                `fetch_interval (${this.json.fetch_interval_sec})`,
                `MUST be less than collect_interval_sec (${this.json.collect_interval_sec})`
            ].join(" "));
        }

        if (this.reminders.length > 0) {
            for (const reminder of this.reminders) {
                if (reminder.day_of_month == undefined) {
                    return Expected.err(`${fail_prefix}: 'day_of_month' MUST be specified`);
                }
                if (reminder.hour_utc == undefined) {
                    return Expected.err(`${fail_prefix}: 'hour_utc' MUST be specified`);
                }
                if (reminder.day_of_month < 1 || reminder.day_of_month > 31) {
                    return Expected.err(`${fail_prefix}: 'day_of_month' MUST be between 1 and 31`);
                }
                if (reminder.hour_utc < 0 || reminder.hour_utc > 23) {
                    return Expected.err(`${fail_prefix}: 'hour_utc' MUST be between 0 and 23`);
                }
            }
            if (this.json.reminder_cooldown_hours == undefined) {
                return Expected.err(`${fail_prefix}: 'reminder_cooldown_hours' MUST be specified`);
            }
            if (this.json.startup_reminders_freeze_sec == undefined) {
                return Expected.err(`${fail_prefix}: 'startup_reminders_freeze_sec' MUST be specified`);
            }
        }

        if (this.accounts.length > 0) {
            for (const account of this.accounts) {
                if (!account.title) {
                    return Expected.err(`${fail_prefix}: account's 'title' MUST be specified`);
                }
                if (!account.account) {
                    return Expected.err(`${fail_prefix}: account's 'account' MUST be specified`);
                }
            }
        }

        return Expected.ok(undefined);
    }
}

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
    total_change: number;
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
        const changes: DepositChange = { total_change: 0 };
        if (prev.tgid !== next.tgid) {
            return undefined;
        }

        let has_changes = false;
        if (prev.balance !== next.balance) {
            changes.balance = [prev.balance, next.balance];
            changes.total_change += next.balance - prev.balance;
            has_changes = true;
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
                changes.total_change += next_amount - prev_amount;
                has_changes = true;
            }
        }

        return has_changes ? changes : undefined;
    }
}

type TableColumns = {
    tgid: number,
    chorister: number,
    credit: number,
    debit: number,
    months: Map<number, number> // timestamp -> column index
}

function try_parse_header(header: string[]): Expected<TableColumns> {
    const columns = header.map(h => h.toLowerCase().trim());

    if (columns.length < 5) { // minimum: tgid, chorister, credit, debit, and at least 1 month
        return Expected.err("Header must contain at least 5 columns");
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

    constructor(private readonly config: DepositTrackingConfig) {
        this.sheet = new GoogleSpreadsheet(this.config.google_sheet_id);
    }

    async start(): Promise<Status> {
        return this.proceed();
    }

    get_user_deposit(tg_id: string): Deposit | undefined {
        return this.choristers.get(tg_id);
    }

    async proceed(): Promise<Status> {
        if (!this.time_to_fetch()) {
            return Expected.ok(undefined);
        }

        const sheet_status = await this.sheet.read("A:K");
        if (!sheet_status.ok) {
            return sheet_status.wrap_error("can't fetch sheet data");
        }
        const table = sheet_status.value!;
        if (table.length < 2) {
            return Expected.ok(undefined); // Just no any data (or header only), not an error
        }

        const header = table[0];
        const header_status = try_parse_header(header);
        if (!header_status.ok) {
            return header_status.wrap_error("invalid header");
        }
        const columns = header_status.value!;

        const deposits = table.slice(1).map(row => try_parse_row(row, columns));

        deposits.forEach((deposit) => {
            if (deposit && deposit.tgid) {
                this.choristers.set(deposit.tgid, deposit);
            }
        });
        return Expected.ok(undefined);
    }

    // Check if it is time to fetch data since previous check.
    // NOTE: if function returns true, last_fetch_date is set to current time.
    private time_to_fetch(): boolean {
        const now_ms = new Date().getTime();
        if (!this.last_fetch_date) {
            this.last_fetch_date = new Date();
            return true;
        }
        const fetch_interval_ms = this.config.fetch_interval_sec * 1000;
        const time_since_last_fetch = now_ms - this.last_fetch_date.getTime();
        if (time_since_last_fetch < fetch_interval_ms) {
            return false;
        }
        this.last_fetch_date = new Date();
        return true;
    }
}