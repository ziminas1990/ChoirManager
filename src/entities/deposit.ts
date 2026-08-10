import { current_month } from "@src/utils.js";

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
