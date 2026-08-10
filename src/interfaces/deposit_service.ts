import { Deposit, DepositChange } from "@src/entities/deposit.js";
import { Transaction } from "@src/interfaces/transactions_storage.js";
import { Expected } from "@src/utils/expected.js";

export type DepositEvent = {
    what: "update";
    tgid: string;
    deposit: Deposit;
    changes: DepositChange;
} | {
    what: "reminder";
    tgid: string;
    chorister: string;
    amount: number;
}

// Service logic: caching, change detection, reminders, and transaction writes.
// Events are delivered via IBroadcaster, not this request/response API.
export interface IDepositService {

    get_deposit(tgid: string): Promise<Expected<Deposit | undefined>>;

    fetch_transactions(
        tgid: string,
        opts: { limit?: number; order?: "asc" | "desc" },
    ): Promise<Transaction[]>;
}
