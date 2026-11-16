import type { TelegramUser } from "@src/adapters/telegram/telegram_user.js";
import { Language } from "@src/entities/user.js";
import { Transaction } from "@src/interfaces/transactions_storage.js";
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
            ? Messages.table(transactions, lang)
            : (lang === Language.RU
                ? "Нет транзакций за последние 6 месяцев."
                : "No transactions found for the last 6 months.");
        return (await this.user.send_message(message)).as_status();
    }
}

class Messages {
    static table(transactions: readonly Transaction[], lang: Language): string {
        const ru = lang === Language.RU;
        const headings = ru
            ? ["Дата", "Операция", "Баланс", "Комментарий"]
            : ["Date", "Operation", "Balance", "Comment"];
        const rows = transactions.map(tx => {
            const change = tx.after - tx.before;
            const credit = change >= 0;
            const operation = ru ? (credit ? "Пополнение" : "Списание") : (credit ? "Top-up" : "Withdrawal");
            const balance = tx.before === tx.after ? String(tx.after) : `${tx.before} -&gt; ${tx.after}`;
            const comment = tx.type === "membership"
                ? (ru ? "оплата членского взноса" : "Membership fee payment")
                : (ru ? (credit ? "пополнение депозита" : "списание депозита")
                    : (credit ? "Deposit top-up" : "Deposit withdrawal"));
            return "<tr>"
                + `<td>${Helpers.format_date(tx.date, lang)}</td>`
                + `<td>${operation} ${Math.abs(change)}</td>`
                + `<td align="right">${balance}</td>`
                + `<td>${comment}</td></tr>`;
        });
        return [
            `<h3>${ru ? "Транзакции за последние 6 месяцев:" : "Transactions for the last 6 months:"}</h3>`,
            "<table bordered striped compact>",
            `<tr>${headings.map(heading => `<th>${heading}</th>`).join("")}</tr>`,
            ...rows,
            "</table>",
        ].join("");
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

    static format_date(date: Date, lang: Language): string {
        const months = lang === Language.RU
            ? ["ЯНВ", "ФЕВ", "МАР", "АПР", "МАЙ", "ИЮН", "ИЮЛ", "АВГ", "СЕН", "ОКТ", "НОЯ", "ДЕК"]
            : ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
        const year = date.getFullYear();
        const day = String(date.getDate()).padStart(2, "0");
        const base = `${day} ${months[date.getMonth()]}`;
        return year !== new Date().getFullYear() ? `${year} ${base}` : base;
    }
}
