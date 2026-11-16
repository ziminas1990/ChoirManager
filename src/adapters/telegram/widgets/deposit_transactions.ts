import type { TelegramUser } from "@src/adapters/telegram/telegram_user.js";
import { Language } from "@src/entities/user.js";
import { Transaction } from "@src/interfaces/transactions_storage.js";
import { DepositTransactionsMessages } from "@src/utils/string_engine/deposit_transactions.js";
import { Status } from "@src/utils/expected.js";

export class DepositTransactionsWidget {
    constructor(
        private readonly user: TelegramUser,
        private readonly transactions: readonly Transaction[] | undefined,
    ) {}

    async start(now: Date = new Date()): Promise<Status> {
        const lang = this.user.info().lang;
        const from = Helpers.six_months_ago(now);
        const transactions = (this.transactions ?? []).filter(tx => tx.date >= from && tx.date <= now);
        const message = transactions.length > 0
            ? DepositTransactionsMessages.table(transactions, lang, lang === Language.RU
                ? "Транзакции за последние 6 месяцев:" : "Transactions for the last 6 months:")
            : (lang === Language.RU
                ? "Нет транзакций за последние 6 месяцев."
                : "No transactions found for the last 6 months.");
        return (await this.user.send_message(message)).as_status();
    }
}

class Helpers {
    static six_months_ago(now: Date): Date {
        const from = new Date(now);
        const day = from.getUTCDate();
        from.setUTCMonth(from.getUTCMonth() - 6);
        if (from.getUTCDate() !== day) {
            from.setUTCDate(0);
        }
        return from;
    }
}
