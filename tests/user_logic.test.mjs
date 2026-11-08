import assert from "node:assert/strict";
import { test } from "node:test";

import { UserService } from "../dist/components/user_service.js";
import { Language, Role, Voice } from "../dist/entities/user.js";
import { UserLogic } from "../dist/logic/user.js";
import { apply_cas_patch } from "../dist/utils/cas_patch.js";
import { Expected } from "../dist/utils/expected.js";

const logger = { info() {}, warn() {}, error() {}, debug() {} };
const journal = { child() { return this; }, log() { return logger; } };

function profile(system_id, roles) {
    return {
        id: { system_id, tg_username: system_id },
        name: "Member", surname: "Singer", lang: Language.EN,
        voice: Voice.Alto, roles: [...roles],
    };
}

async function fixture(roles = Object.values(Role), failure) {
    const initial = profile("member-id", roles);
    const other = profile("other-id", [Role.Chorister]);
    const records = new Map([initial, other].map(user => [user.id.system_id, user]));
    const state = { failure, storage_reads: 0, lookups: [], agent_calls: [], ticks: [] };
    const users = new UserService({
        async get_all() {
            state.storage_reads += 1;
            return Expected.ok(structuredClone([...records.values()]));
        },
        async update(system_id, patch) {
            const updated = apply_cas_patch(records.get(system_id), patch);
            if (updated.ok) {
                records.set(system_id, updated.value);
            }
            return updated;
        },
    }, journal);
    assert.equal((await users.init()).ok, true);
    const source = users.as_replica();
    const replica = {
        ...source,
        resolve_user(id) {
            state.lookups.push(id);
            if (state.failure === "error") {
                return Expected.err("replica unavailable");
            }
            if (state.failure === "exception") {
                throw new Error("replica unavailable");
            }
            if (state.failure === "missing") {
                return Expected.ok(undefined);
            }
            return source.resolve_user(id);
        },
    };
    const logic = new UserLogic("member-id", structuredClone(initial), 100, journal, replica);
    const other_logic = new UserLogic("other-id", other, 100, journal, source);
    const capabilities = {
        chorister: { kind: "chorister" }, admin: { kind: "admin" },
        deposit_owner: { kind: "deposit_owner" }, accountant: { kind: "accountant" },
    };
    const agent = {
        as_chorister() { state.agent_calls.push("chorister"); return capabilities.chorister; },
        as_admin() { state.agent_calls.push("admin"); return capabilities.admin; },
        as_deposit_owner() { state.agent_calls.push("deposit_owner"); return capabilities.deposit_owner; },
        as_accounter() { state.agent_calls.push("accountant"); return capabilities.accountant; },
        async proceed(now) { state.ticks.push(now); },
    };
    logic.add_agent(agent);
    return { logic, other_logic, users, state, agent, capabilities };
}

for (const [role, method] of [
    [Role.Admin, "is_admin"],
    [Role.Accountant, "is_accountant"],
    [Role.Chorister, "is_chorister"],
    [Role.Conductor, "is_member"],
    [Role.ExChorister, "is_ex_chorister"],
    [Role.Manager, "has_no_roles"],
]) {
    test(`${method} observes ${role} grants and revocations without a session tick`, async () => {
        // Motivation: each public role predicate must consult the shared local
        // replica instead of trusting the profile captured by an older session.

        // 1. create a guest session over the real user service's replica
        let context;
        {
            context = await fixture([]);
        }

        // 2. grant a role through the user service and immediately check it
        {
            const updated = await context.users.update("member-id", { roles: { append: [role] } });
            assert.equal(updated.ok, true);
            assert.deepEqual(context.logic.data.roles, []);
            assert.equal(context.logic[method](), method !== "has_no_roles");
            assert.equal(context.logic.has_no_roles(), false);
        }

        // 3. revoke the role and immediately deny access through the same predicate
        {
            const updated = await context.users.update("member-id", {
                roles: { remove: [{ index: 0, value: role }] },
            });
            assert.equal(updated.ok, true);
            assert.deepEqual(context.logic.data.roles, [role]);
            assert.equal(context.logic[method](), method === "has_no_roles");
            assert.equal(context.logic.has_no_roles(), true);
            assert.equal(context.other_logic.is_chorister(), true);
        }

        // 4. restore the role without recreating the session or reading storage
        {
            assert.equal((await context.users.update("member-id", {
                roles: { append: [role] },
            })).ok, true);
            assert.equal(context.logic[method](), method !== "has_no_roles");
            assert.equal(context.state.storage_reads, 1);
            assert.deepEqual(context.state.ticks, []);
            assert.ok(context.state.lookups.length > 0);
            assert.ok(context.state.lookups.every(id => id.system_id === "member-id"
                && id.tg_username === undefined));
        }
    });
}

test("an active session revokes privileged agents immediately and restores only current roles", async () => {
    // Motivation: background actions obtain role-specific agents from UserLogic;
    // a recent session tick must not preserve access for another ten seconds.

    // 1. initialize an authorized session and run its current tick
    let context;
    const now = new Date();
    {
        context = await fixture();
        assert.equal((await context.logic.proceed_impl(now, 100)).ok, true);
    }

    // 2. remove all roles while retaining the session's old profile snapshot
    {
        const updated = await context.users.update("member-id", {
            roles: { expected: Object.values(Role), remove: Object.values(Role)
                .map((value, index) => ({ index, value })) },
        });
        assert.equal(updated.ok, true);
        assert.deepEqual(context.logic.data.roles, Object.values(Role));
    }

    // 3. refuse every privileged agent before time advances or another tick runs
    {
        assert.deepEqual(context.logic.as_admin(), []);
        assert.deepEqual(context.logic.as_chorister(), []);
        assert.deepEqual(context.logic.as_deposit_owner(), []);
        assert.deepEqual(context.logic.as_accounter(), []);
        assert.deepEqual(context.state.agent_calls, []);
        assert.equal(context.logic.is_member(), false);
        assert.equal(context.logic.has_no_roles(), true);
        assert.equal(context.other_logic.is_chorister(), true);
    }

    // 4. regrant Chorister and recover only the matching existing agents
    {
        assert.equal((await context.users.update("member-id", {
            roles: { append: [Role.Chorister] },
        })).ok, true);
        assert.deepEqual(context.logic.as_chorister(), [context.capabilities.chorister]);
        assert.deepEqual(context.logic.as_deposit_owner(), [context.capabilities.deposit_owner]);
        assert.deepEqual(context.logic.as_admin(), []);
        assert.deepEqual(context.logic.as_accounter(), []);
        assert.equal(context.logic.is_member(), true);
        assert.deepEqual(context.logic.all_agents(), [context.agent]);
        assert.equal(context.state.storage_reads, 1);
    }
});

for (const failure of ["missing", "error", "exception"]) {
    test(`UserLogic fails closed on ${failure} without stopping its agents`, async () => {
        // Motivation: cached privileged roles must not survive an unavailable
        // lookup, while the generic session must keep processing guest messages.

        // 1. construct a session with old privileges and unavailable permission data
        let context;
        const now = new Date();
        {
            context = await fixture(Object.values(Role), failure);
        }

        // 2. deny every protected role and agent despite the cached profile
        {
            assert.equal(context.logic.is_admin(), false);
            assert.equal(context.logic.is_accountant(), false);
            assert.equal(context.logic.is_chorister(), false);
            assert.equal(context.logic.is_member(), false);
            assert.equal(context.logic.is_ex_chorister(), false);
            assert.equal(context.logic.has_no_roles(), true);
            assert.deepEqual(context.logic.as_admin(), []);
            assert.deepEqual(context.logic.as_chorister(), []);
            assert.deepEqual(context.logic.as_deposit_owner(), []);
            assert.deepEqual(context.logic.as_accounter(), []);
            assert.deepEqual(context.state.agent_calls, []);
            assert.deepEqual(context.logic.data.roles, Object.values(Role));
        }

        // 3. keep the generic agent running even while permission data is unavailable
        {
            assert.equal((await context.logic.proceed_impl(now, 100)).ok, true);
            assert.deepEqual(context.state.ticks, [now]);
        }

        // 4. recover the replica with fewer roles and immediately restore matching access
        {
            assert.equal((await context.users.update("member-id", {
                roles: { remove: Object.values(Role).map((value, index) => ({ index, value })),
                    append: [Role.Chorister] },
            })).ok, true);
            context.state.failure = undefined;
            assert.deepEqual(context.logic.as_chorister(), [context.capabilities.chorister]);
            assert.equal(context.logic.is_admin(), false);
            assert.equal(context.logic.is_accountant(), false);
            assert.equal(context.logic.has_no_roles(), false);
            assert.equal(context.state.storage_reads, 1);
        }
    });
}

test("consecutive ticks refresh profile fields without the former ten-second delay", async () => {
    // Motivation: removing the session's refresh timer must keep display fields
    // current as well as permissions, using memory rather than a storage reload.

    // 1. start a session and refresh its initial profile
    let context;
    const now = new Date();
    {
        context = await fixture([Role.Chorister]);
        assert.equal((await context.logic.proceed_impl(now, 100)).ok, true);
    }

    // 2. change profile fields through the shared user service
    {
        assert.equal((await context.users.update("member-id", {
            name: ["Member", "Updated"], lang: [Language.EN, Language.RU],
        })).ok, true);
        assert.equal(context.logic.data.name, "Member");
    }

    // 3. refresh on the next tick only one hundred milliseconds later
    {
        assert.equal((await context.logic.proceed_impl(new Date(now.getTime() + 100), 100)).ok, true);
        assert.equal(context.logic.data.name, "Updated");
        assert.equal(context.logic.data.lang, Language.RU);
        assert.equal(context.state.ticks.length, 2);
        assert.equal(context.state.storage_reads, 1);
    }
});
