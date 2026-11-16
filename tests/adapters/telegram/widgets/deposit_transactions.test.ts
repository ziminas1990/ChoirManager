import assert from "node:assert/strict";
import * as TelegramBot from "node-telegram-bot-api";
import { after, mock, test } from "node:test";

import { DepositOwnerDialog } from "@src/adapters/telegram/dialogs/deposit_owner_dialog.js";
import { TelegramUser } from "@src/adapters/telegram/telegram_user.js";
import { DepositTransactionsWidget } from "@src/adapters/telegram/widgets/deposit_transactions.js";
import { Environment } from "@src/components/environment.js";
import { MemoryJournal } from "@src/components/memory_journal.js";
import { Deposit } from "@src/entities/deposit.js";
import { Language, Role } from "@src/entities/user.js";
import { Transaction } from "@src/interfaces/transactions_storage.js";
import { CoreAPI } from "@src/use_cases/core.js";
import { GlobalFormatter } from "@src/utils.js";
import { Expected } from "@src/utils/expected.js";

import { telegram_config } from "@tests/helpers/config.js";
import { user_profile } from "@tests/helpers/user.js";
import { inline_grid, mock_telegram, telegram_callback } from "@tests/mocks/telegram.js";
import { mock_user_replica } from "@tests/mocks/user_replica.js";
import { mock_user_service } from "@tests/mocks/user_service.js";

mock.method(CoreAPI, "on_new_user_agent", () => Expected.ok(undefined));
after(() => mock.restoreAll());
GlobalFormatter.init("html");

function history(count: number): Transaction[] {
    return Array.from({ length: count }, (_, index) => ({
        date: new Date(Date.now() - index * 24 * 60 * 60 * 1000),
        tgid: "member",
        type: index % 2 === 0 ? "balance" : "membership",
        before: 50,
        after: 100 - index,
    }));
}

function fixture(lang = Language.EN, transactions = history(23)) {
    const profile = user_profile("member", { lang, roles: [Role.Chorister] });
    const state = {
        messages: [] as string[],
        keyboards: [] as TelegramBot.SendRichMessageParams[],
        requests: [] as string[],
    };
    const environment = new Environment();
    environment.user_service = mock_user_service({ resolve_user: async () => Expected.ok(profile) });
    environment.deposit_service = {
        get_deposit: async () => Expected.ok(undefined),
        fetch_transactions: async tgid => {
            state.requests.push(tgid);
            return transactions;
        },
    };
    Environment.set_global(environment);
    const bot = mock_telegram({
        sendRichMessage: async (params) => {
            const { rich_message } = params;
            state.keyboards.push(params);
            state.messages.push(rich_message.html!);
            return { message_id: 99 + state.messages.length };
        },
        answerCallbackQuery: async () => {},
    });
    const user = new TelegramUser(profile, 123, telegram_config(), {
        users: mock_user_replica({ resolve_user: () => Expected.ok(profile) }),
    }, new MemoryJournal());
    assert.equal(user.init(bot).ok, true);
    const dialog = new DepositOwnerDialog(user, new MemoryJournal());
    return { user, dialog, state, transactions };
}

function rows(html: string): string[][] {
    return [...html.matchAll(/<tr>(.*?)<\/tr>/g)]
        .map(row => [...row[1].matchAll(/<td[^>]*>(.*?)<\/td>/g)]
            .map(cell => cell[1].replace(/&gt;/g, ">")))
        .filter(row => row.length > 0);
}

async function click(context: ReturnType<typeof fixture>, data: string | undefined) {
    context.user.put_incoming_item({
        what: "callback",
        callback: telegram_callback({ data }),
    });
    await context.user.proceed(new Date());
}

for (const lang of [Language.RU, Language.EN]) {
    test(`deposit history sends all recent transactions without controls in ${lang}`, async () => {
        // Motivation: recent histories must include records beyond the old
        // ten-row limit without requiring buttons or message editing.

        // 1. create a deposit summary with the existing history entry point
        let context;
        let expected;
        {
            context = fixture(lang);
            expected = structuredClone(context.transactions);
            assert.equal((await context.dialog.send_deposit_info(
                new Deposit("member", "Member", 50, new Map()))).ok, true);
        }

        // 2. open the full history without registering any further callbacks
        {
            mock.method(context.user, "create_callback_button", () => {
                throw new Error("transaction history must not register callbacks");
            });
            mock.method(context.user, "edit_message", async () => {
                throw new Error("transaction history must not edit messages");
            });
            await click(context, inline_grid(context.state.keyboards[0])[0][0].callback_data);
        }

        // 3. verify all 23 rows, original ordering and no navigation markup
        {
            const html = context.state.messages[1];
            assert.equal(rows(html).length, 23);
            assert.deepEqual(rows(html).map(row => row[2]), expected.map(tx => `50 -> ${tx.after}`));
            assert.doesNotMatch(html, /<tg-button|<p>\d+ \/ \d+<\/p>/);
            assert.ok(html.endsWith("</table>"));
            assert.equal(context.state.messages.length, 2);
            assert.deepEqual(context.state.requests, ["member"]);
            assert.deepEqual(context.transactions, expected);
        }
    });

    test(`operations, balances and transaction comments are localized in ${lang}`, async () => {
        // Motivation: compact rows must show unsigned operation amounts and
        // balance transitions, including unchanged balances and adjustments.

        // 1. supply credits, withdrawals, membership adjustments and zero change
        let context;
        {
            const transactions = history(4);
            transactions[0] = { ...transactions[0], before: 150.5, after: 100.25 };
            transactions[1] = { ...transactions[1], before: 20, after: 80 };
            transactions[2] = { ...transactions[2], before: 75, after: 75 };
            transactions[3] = { ...transactions[3], before: 80, after: -5 };
            context = fixture(lang, transactions);
        }

        // 2. send the localized history
        {
            assert.equal((await context.dialog.send_transactions_info(context.transactions)).ok, true);
        }

        // 3. verify four columns with unsigned operations and balance transitions
        {
            const html = context.state.messages[0];
            const ru = lang === Language.RU;
            assert.deepEqual(rows(html).map(row => row.slice(1)), [
                [ru ? "Списание 50.25" : "Withdrawal 50.25", "150.5 -> 100.25", ru ? "списание депозита" : "Deposit withdrawal"],
                [ru ? "Пополнение 60" : "Top-up 60", "20 -> 80", ru ? "оплата членского взноса" : "Membership fee payment"],
                [ru ? "Пополнение 0" : "Top-up 0", "75", ru ? "пополнение депозита" : "Deposit top-up"],
                [ru ? "Списание 85" : "Withdrawal 85", "80 -> -5", ru ? "оплата членского взноса" : "Membership fee payment"],
            ]);
            assert.deepEqual([...html.matchAll(/<th>(.*?)<\/th>/g)].map(match => match[1]), ru
                ? ["Дата", "Операция", "Баланс", "Комментарий"]
                : ["Date", "Operation", "Balance", "Comment"]);
            assert.doesNotMatch(html, /GEL|₾/);
            assert.ok(html.endsWith("</table>"));
            assert.doesNotMatch(html, /<tg-button/);
            assert.deepEqual(inline_grid(context.state.keyboards.at(-1)!), []);
        }
    });

    for (const empty of [[], undefined]) {
        test(`empty transaction history has no table or navigation in ${lang} (${empty})`, async () => {
            // Motivation: missing histories need a clear localized response
            // rather than an empty table or unusable page controls.

            // 1. create a localized deposit dialog
            let context;
            {
                context = fixture(lang);
            }

            // 2. deliver the empty history and verify its complete response
            {
                assert.equal((await context.dialog.send_transactions_info(empty)).ok, true);
                assert.deepEqual(context.state.messages, [lang === Language.RU
                    ? "Нет транзакций за последние 6 месяцев."
                    : "No transactions found for the last 6 months."]);
            }
        });
    }
}

for (const [now_text, from_text] of [
    ["2026-11-16T12:34:56.789Z", "2026-05-16T12:34:56.789Z"],
    ["2026-08-31T12:34:56.789Z", "2026-02-28T12:34:56.789Z"],
    ["2024-08-31T12:34:56.789Z", "2024-02-29T12:34:56.789Z"],
    ["2026-03-31T12:34:56.789Z", "2025-09-30T12:34:56.789Z"],
]) {
    test(`history includes only the last six calendar months as of ${now_text}`, async () => {
        // Motivation: the rolling period must include its boundaries and
        // handle short months without dropping valid transactions.

        // 1. place transactions on both sides of the date boundaries
        let context;
        let now;
        let original;
        {
            now = new Date(now_text);
            const from = new Date(from_text);
            const transactions = history(4);
            transactions[0].date = now;
            transactions[1].date = new Date(from.getTime() - 1);
            transactions[2].date = from;
            transactions[2].type = "membership";
            transactions[2].membership_month = new Date("2000-01-01T00:00:00Z");
            transactions[3].date = new Date(now.getTime() + 1);
            original = structuredClone(transactions);
            context = fixture(Language.EN, transactions);
        }

        // 2. render the history using a fixed current time
        {
            const status = await new DepositTransactionsWidget(context.user, context.transactions).start(now);
            assert.equal(status.ok, true);
        }

        // 3. verify inclusive bounds, preserved order and transaction dates
        {
            const html = context.state.messages[0];
            assert.deepEqual(rows(html).map(row => row[2]), ["50 -> 100", "50 -> 98"]);
            assert.match(html, /Transactions for the last 6 months:/);
            assert.deepEqual(context.transactions, original);
            assert.equal(now.toISOString(), now_text);
        }
    });
}

for (const lang of [Language.RU, Language.EN]) {
    test(`an entirely old history produces the localized empty state in ${lang}`, async () => {
        // Motivation: filtering can empty a nonempty history, which must
        // produce the same clear period-specific response as missing data.

        // 1. provide a transaction before the six-month window
        let context;
        {
            const transactions = history(1);
            transactions[0].date = new Date("2020-01-01T00:00:00Z");
            context = fixture(lang, transactions);
        }

        // 2. verify the localized response instead of an empty table
        {
            const now = new Date("2026-11-16T12:00:00Z");
            const status = await new DepositTransactionsWidget(context.user, context.transactions).start(now);
            assert.equal(status.ok, true);
            assert.deepEqual(context.state.messages, [lang === Language.RU
                ? "Нет транзакций за последние 6 месяцев."
                : "No transactions found for the last 6 months."]);
        }
    });
}

