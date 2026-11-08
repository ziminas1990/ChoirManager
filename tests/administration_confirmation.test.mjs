import assert from "node:assert/strict";
import { test } from "node:test";

import { AdministrationService } from "../dist/components/administration_service.js";
import { UserService } from "../dist/components/user_service.js";
import { Language, Role, Voice } from "../dist/entities/user.js";
import { AdministrationError } from "../dist/interfaces/administration_service.js";
import { apply_cas_patch } from "../dist/utils/cas_patch.js";
import { Expected } from "../dist/utils/expected.js";

const logger = { info() {}, warn() {}, error() {}, debug() {} };
const journal = { child() { return this; }, log() { return logger; } };

function profile(system_id, roles) {
    return {
        id: { system_id, tg_username: system_id },
        name: system_id, surname: "Singer", lang: Language.EN,
        voice: Voice.Alto, roles,
    };
}

async function fixture() {
    const actor = profile("actor", [Role.Admin, Role.Chorister]);
    const target = profile("target", [Role.Chorister]);
    const other = profile("other", [Role.Admin]);
    const records = new Map([actor, target, other].map(user => [user.id.system_id, user]));
    const writes = [];
    const collection = {
        async get_all() {
            return Expected.ok(structuredClone([...records.values()]));
        },
        async create(user) {
            writes.push({ what: "create", system_id: user.id.system_id });
            records.set(user.id.system_id, structuredClone(user));
            return Expected.ok(structuredClone(user));
        },
        async update(system_id, patch) {
            const updated = apply_cas_patch(records.get(system_id), patch);
            if (!updated.ok) {
                return updated;
            }
            writes.push({ what: "update", system_id });
            records.set(system_id, updated.value);
            return Expected.ok(structuredClone(updated.value));
        },
    };
    const users = new UserService(collection, journal);
    assert.equal((await users.init()).ok, true);
    const administration = new AdministrationService(3600, 10, users, journal);
    return { actor, target, records, writes, users, administration };
}

async function request(context, operation) {
    let result;
    if (operation === "create") {
        result = await context.administration.request_create_user(
            "actor", { ...profile("new-member", [Role.Chorister]),
                id: { system_id: "", tg_username: "new-member" } });
    } else if (operation === "update") {
        result = await context.administration.request_update_user(
            "actor", "target", { name: ["target", "Updated"] });
    } else {
        result = await context.administration.request_remove_member("actor", "target");
    }
    assert.equal(result.ok, true, result.ok ? undefined : result.error);
    return result.value;
}

for (const operation of ["create", "update", "remove"]) {
    test(`${operation} confirmation rechecks Admin and invalidates a demoted initiator's request`, async () => {
        // Motivation: all administrative operations share a confirmation gate;
        // permissions at request time must not authorize a later write.

        // 1. create real services over an in-memory user collection
        let context;
        {
            context = await fixture();
        }

        // 2. propose an operation while the actor is still an administrator
        let pending;
        {
            pending = await request(context, operation);
            assert.deepEqual(context.writes, []);
        }

        // 3. revoke only Admin through the user service before confirmation
        {
            const demoted = await context.users.update("actor", {
                roles: { remove: [{ index: 0, value: Role.Admin }] },
            });
            assert.equal(demoted.ok, true);
            assert.deepEqual(demoted.value.roles, [Role.Chorister]);
        }

        // 4. reject confirmation without persisting any part of the proposal
        {
            const result = await context.administration.confirm("actor", pending.id);
            assert.equal(result.is_error(AdministrationError.ActorNotAdmin), true);
            assert.deepEqual(context.writes, [{ what: "update", system_id: "actor" }]);
            assert.deepEqual(context.records.get("target"), context.target);
            assert.equal(context.records.size, 3);
        }

        // 5. restore Admin and verify the rejected request cannot be reused
        {
            const restored = await context.users.update("actor", {
                roles: { append: [Role.Admin] },
            });
            assert.equal(restored.ok, true);
            const result = await context.administration.confirm("actor", pending.id);
            assert.equal(result.is_error(AdministrationError.PendingNotFound), true);
            assert.equal(context.writes.length, 2);
        }

        // 6. apply a fresh proposal once the initiator has current Admin access
        {
            const fresh = await request(context, operation);
            const result = await context.administration.confirm("actor", fresh.id);
            assert.equal(result.ok, true, result.ok ? undefined : result.error);
            assert.equal(result.value.what, {
                create: "user_created", update: "user_updated", remove: "member_removed",
            }[operation]);
            assert.equal(context.writes.length, 3);
            assert.equal(context.writes[2].what, operation === "create" ? "create" : "update");
            assert.equal(context.writes[2].system_id === "actor", false);
        }
    });
}

test("an unavailable actor lookup blocks confirmation and permits a later retry", async () => {
    // Motivation: a permission lookup outage must not use an earlier Admin
    // snapshot or consume a request whose initiator may still be authorized.

    // 1. create a pending request and retain the working actor lookup
    let context;
    let pending;
    let resolve_user;
    {
        context = await fixture();
        pending = await request(context, "remove");
        resolve_user = context.users.resolve_user.bind(context.users);
    }

    // 2. fail the lookup and refuse confirmation without changing the target
    {
        context.users.resolve_user = async () => Expected.err("user service unavailable");
        const result = await context.administration.confirm("actor", pending.id);
        assert.equal(result.is_error(AdministrationError.ActorResolveFailed), true);
        assert.deepEqual(context.writes, []);
        assert.deepEqual(context.records.get("target"), context.target);
    }

    // 3. recover the lookup and apply the still-pending request once
    {
        context.users.resolve_user = resolve_user;
        const result = await context.administration.confirm("actor", pending.id);
        assert.equal(result.ok, true, result.ok ? undefined : result.error);
        assert.equal(result.value.what, "member_removed");
        assert.deepEqual(context.records.get("target").roles, []);
        assert.deepEqual(context.writes, [{ what: "update", system_id: "target" }]);
    }
});

test("a missing initiator cannot confirm or revive a pending request", async () => {
    // Motivation: when an actor profile cannot be found, a surviving request
    // must not retain privileges or become usable when the profile reappears.

    // 1. create a pending request while the initiator exists and has Admin
    let context;
    let pending;
    {
        context = await fixture();
        pending = await request(context, "remove");
    }

    // 2. refresh the user service after the actor disappears from storage
    {
        context.records.delete("actor");
        assert.equal((await context.users.as_replica().sync()).ok, true);
        const result = await context.administration.confirm("actor", pending.id);
        assert.equal(result.is_error(AdministrationError.ActorNotFound), true);
        assert.deepEqual(context.writes, []);
        assert.deepEqual(context.records.get("target"), context.target);
    }

    // 3. restore the actor and verify that the old request is no longer usable
    {
        context.records.set("actor", context.actor);
        assert.equal((await context.users.as_replica().sync()).ok, true);
        const result = await context.administration.confirm("actor", pending.id);
        assert.equal(result.is_error(AdministrationError.PendingNotFound), true);
        assert.deepEqual(context.writes, []);
    }
});

test("another administrator cannot confirm or consume the initiator's request", async () => {
    // Motivation: current Admin access is necessary but does not transfer
    // ownership of a pending operation to a different administrator.

    // 1. create a pending removal owned by the original administrator
    let context;
    let pending;
    {
        context = await fixture();
        pending = await request(context, "remove");
    }

    // 2. refuse confirmation from a different administrator without a write
    {
        const result = await context.administration.confirm("other", pending.id);
        assert.equal(result.ok, false);
        assert.deepEqual(context.writes, []);
        assert.deepEqual(context.records.get("target"), context.target);
    }

    // 3. allow the authorized initiator to confirm the original request
    {
        const result = await context.administration.confirm("actor", pending.id);
        assert.equal(result.ok, true, result.ok ? undefined : result.error);
        assert.deepEqual(context.records.get("target").roles, []);
        assert.deepEqual(context.writes, [{ what: "update", system_id: "target" }]);
    }
});
