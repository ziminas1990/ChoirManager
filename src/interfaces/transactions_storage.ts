//import { StatusWith } from "@src/status.js";

export type Transaction = {
    date: Date,
    change: number,
    balance_after: number,
    tgid: string
};

export interface ITransactionsStorage {
    fetch_transactions(user_tg_id: string): Promise<Transaction[]>; //Promise<StatusWith<Transaction[]>>
    logBalanceChange(e: Transaction): Promise<void>;
}