
export type Transaction = {
    date: Date,
    change: number,
    balance_after: number,
    tgid: string
};

export interface ITransactionsStorage {
    fetch_transactions(user_tg_id: string, 
        opts: { limit?: number; order?: "asc" | "desc" }): Promise<Transaction[]>;
    add_transaction(e: Transaction): Promise<void>;
}