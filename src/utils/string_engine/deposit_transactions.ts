import { Language } from "@src/entities/user.js";
import { Transaction } from "@src/interfaces/transactions_storage.js";

export class DepositTransactionsMessages {
    static recent(transactions: readonly Transaction[] | undefined, lang: Language): string {
        const unavailable = lang === Language.RU
            ? "Транзакции временно недоступны."
            : "Transactions are temporarily unavailable.";
        if (transactions === undefined) {
            return unavailable;
        }
        try {
            if (transactions.length === 0) {
                return lang === Language.RU ? "Нет транзакций." : "No transactions found.";
            }
            return this.table(transactions, lang,
                lang === Language.RU ? "Последние транзакции:" : "Recent transactions:");
        } catch {
            return unavailable;
        }
    }

    static table(transactions: readonly Transaction[], lang: Language, title: string): string {
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
            `<h3>${title}</h3>`,
            "<table bordered striped compact>",
            `<tr>${headings.map(heading => `<th>${heading}</th>`).join("")}</tr>`,
            ...rows,
            "</table>",
        ].join("");
    }
}

class Helpers {
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
