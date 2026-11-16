import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";

import { LocalBroadcaster } from "@src/adapters/local_message_queue/local_broadcaster.js";
import { DepositService } from "@src/components/deposit_service.js";
import { Environment } from "@src/components/environment.js";
import { MemoryJournal } from "@src/components/memory_journal.js";
import { Deposit } from "@src/entities/deposit.js";
import { DepositEvent } from "@src/interfaces/deposit_service.js";
import { Transaction } from "@src/interfaces/transactions_storage.js";
import { UserLogic } from "@src/logic/user.js";
import { Runtime } from "@src/runtime.js";
import { DepositActions } from "@src/use_cases/deposit_actions.js";
import { Expected } from "@src/utils/expected.js";

import { user_profile } from "@tests/helpers/user.js";
import { mock_accounter } from "@tests/mocks/accounter.js";
import { mock_deposit_owner } from "@tests/mocks/deposit_owner.js";
import { mock_runtime } from "@tests/mocks/runtime.js";
import { mock_user_replica } from "@tests/mocks/user_replica.js";

afterEach(() => mock.restoreAll());

function fixture() {
    const journal = new MemoryJournal();
    const profile = user_profile("member");
    const user = new UserLogic("member", profile, 1000, journal, mock_user_replica());
    const received: (readonly Transaction[] | undefined)[] = [];
    mock.method(user, "as_deposit_owner", () => [0, 1].map(() => mock_deposit_owner({
        send_deposit_changes: async (_deposit, _changes, transactions) => {
            received.push(transactions);
            return Expected.ok(undefined);
        },
    })));
    const accountant = new UserLogic("accountant", user_profile("accountant"),
        1000, journal, mock_user_replica());
    const mirrored: (readonly Transaction[] | undefined)[] = [];
    mock.method(accountant, "as_accounter", () => [mock_accounter({
        mirror_deposit_changes: async (_who, _deposit, _changes, transactions) => {
            mirrored.push(transactions);
            return Expected.ok(undefined);
        },
    })]);
    const runtime = mock_runtime({ get_users: () => [accountant] });
    mock.method(Runtime, "get_instance", () => runtime);
    const environment = new Environment();
    Environment.set_global(environment);
    return { journal, user, received, mirrored, environment };
}

test("deposit updates include the new transaction and load the latest five once", async () => {
    // Motivation: activity must be saved before notification, and the same
    // bounded history must reach every owner agent and accountant copy.

    // 1. connect a real deposit service to stored activity and update events
    let context;
    let service;
    let subscription;
    let current: Deposit;
    let now;
    const records: Transaction[] = [];
    const requests: unknown[] = [];
    {
        context = fixture();
        current = new Deposit("member", "Member", 10, new Map());
        const broadcaster = new LocalBroadcaster<DepositEvent>();
        subscription = broadcaster.subscribe();
        service = new DepositService(0, 0, 140, [], 24, 0,
            { fetch_all: async () => [current] }, {
                add_transaction: async tx => { records.push(tx); },
                fetch_transactions: async (tgid, opts) => {
                    requests.push({ tgid, ...opts });
                    return records.filter(tx => tx.tgid === tgid)
                        .sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, opts.limit);
                },
            }, broadcaster, context.journal);
        context.environment.deposit_service = service;
        records.push(...Array.from({ length: 7 }, (_, index): Transaction => ({
            date: new Date(2020, 0, index + 1), tgid: "member", type: "balance",
            before: index, after: index + 1,
        })));
        now = new Date(Date.now() + 1000);
        assert.equal((await service.init(now)).ok, true);
    }

    // 2. record a deposit change and deliver its emitted notification
    {
        current = new Deposit("member", "Member", 25, new Map());
        assert.equal((await service.proceed(now)).ok, true);
        const event = (await subscription.poll()).value;
        assert.ok(event && event.what === "update");
        assert.equal((await DepositActions.send_deposit_update(context.user,
            event.deposit, event.changes, context.journal)).ok, true);
    }

    // 3. verify a single bounded query includes the newly persisted operation
    {
        assert.deepEqual(requests, [{ tgid: "member", limit: 5, order: "desc" }]);
        assert.equal(context.received.length, 2);
        const transactions = context.received[0]!;
        assert.equal(transactions.length, 5);
        assert.equal(transactions[0].before, 10);
        assert.equal(transactions[0].after, 25);
        assert.deepEqual(transactions.slice(1).map(tx => tx.after), [7, 6, 5, 4]);
        assert.strictEqual(context.received[1], transactions);
        assert.strictEqual(context.mirrored[0], transactions);
    }
});

for (const state of ["empty", "failure", "missing"]) {
    test(`deposit notifications survive ${state} transaction history`, async () => {
        // Motivation: unavailable history must not suppress deposit changes or
        // be presented to recipients as a successfully loaded empty history.

        // 1. provide empty, failing or unconfigured transaction retrieval
        let context;
        let requests = 0;
        {
            context = fixture();
            if (state !== "missing") {
                context.environment.deposit_service = {
                    get_deposit: async () => Expected.ok(undefined),
                    fetch_transactions: async () => {
                        requests += 1;
                        if (state === "failure") {
                            throw new Error("History storage unavailable");
                        }
                        return [];
                    },
                };
            }
        }

        // 2. send the change despite unavailable or empty transaction data
        {
            const status = await DepositActions.send_deposit_update(context.user,
                new Deposit("member", "Member", 25, new Map()),
                { total_change: 15, balance: [10, 25] }, context.journal);
            assert.equal(status.ok, true);
        }

        // 3. verify delivery to every recipient and distinguish failure states
        {
            assert.equal(requests, state === "missing" ? 0 : 1);
            const expected = state === "empty" ? [] : undefined;
            assert.deepEqual(context.received, [expected, expected]);
            assert.deepEqual(context.mirrored, [expected]);
            assert.equal(context.journal.records.filter(record => record.level === "warning").length,
                state === "empty" ? 0 : 1);
        }
    });
}
