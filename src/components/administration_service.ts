import crypto from "crypto";

import {
    Role,
    UserData,
    is_guest_user,
    user_has_role,
} from "@src/entities/user.js";
import {
    AdministrationError,
    AdministrationOperation,
    IAdministrationService,
    OperationResult,
    PendingOperation,
    UserCasPatch,
} from "@src/interfaces/administration_service.js";
import { IUserService, NewUserData } from "@src/interfaces/user_service.js";
import { IJournal } from "@src/interfaces/journal.js";
import { Logic } from "@src/logic/abstracts.js";
import { Expected, Status } from "@src/utils/expected.js";
import { apply_cas_patch } from "@src/utils/cas_patch.js";
import { build_user_data_patch } from "@src/utils/patching/user_data_patch.js";

export class AdministrationService extends Logic<void> implements IAdministrationService {
    private readonly journal: IJournal;
    private readonly pending = new Map<string, PendingOperation>();

    constructor(
        private readonly confirmation_ttl_sec: number,
        private readonly max_pending_per_user: number,
        private readonly users: IUserService,
        parent_journal: IJournal,
    ) {
        super(1000);
        this.journal = parent_journal.child("administration_svc");
    }

    async request_create_user(
        actor_id: string,
        user: UserData,
    ): Promise<Expected<PendingOperation>> {
        const now = new Date();
        const actor = await this.require_admin(actor_id);
        if (!actor.ok) {
            return actor.cast_error<PendingOperation>();
        }

        const limit_status = this.ensure_pending_capacity(actor_id, now);
        if (!limit_status.ok) {
            return limit_status.cast_error<PendingOperation>();
        }

        const operation = await this.plan_create(actor_id, user);
        if (!operation.ok) {
            return operation.cast_error<PendingOperation>();
        }

        return this.enqueue(actor.value, now, operation.value);
    }

    async request_update_user(
        actor_id: string,
        system_id: string,
        patch: UserCasPatch,
    ): Promise<Expected<PendingOperation>> {
        const now = new Date();
        const actor = await this.require_admin(actor_id);
        if (!actor.ok) {
            return actor.cast_error<PendingOperation>();
        }

        const limit_status = this.ensure_pending_capacity(actor_id, now);
        if (!limit_status.ok) {
            return limit_status.cast_error<PendingOperation>();
        }

        const operation = await this.plan_update(actor_id, system_id, patch);
        if (!operation.ok) {
            return operation.cast_error<PendingOperation>();
        }

        return this.enqueue(actor.value, now, operation.value);
    }

    async request_remove_member(
        actor_id: string,
        system_id: string,
    ): Promise<Expected<PendingOperation>> {
        const now = new Date();
        const actor = await this.require_admin(actor_id);
        if (!actor.ok) {
            return actor.cast_error();
        }

        const limit_status = this.ensure_pending_capacity(actor_id, now);
        if (!limit_status.ok) {
            return limit_status.cast_error();
        }

        const operation = await this.plan_remove_member(actor_id, system_id);
        if (!operation.ok) {
            return operation.cast_error();
        }

        return this.enqueue(actor.value, now, operation.value);
    }

    async confirm(actor_id: string, operation_id: string): Promise<Expected<OperationResult>> {
        const actor = await this.require_admin(actor_id);
        if (!actor.ok) {
            // A demoted initiator must not leave the request pending until expiry.
            if (!actor.is_error([AdministrationError.ActorResolveFailed])) {
                this.drop_pending_if_initiator(actor_id, operation_id);
            }
            return actor.cast_error();
        }

        const pending = this.take_if_actionable(actor_id, operation_id, new Date());
        if (!pending.ok) {
            return pending.cast_error();
        }

        const applied = await this.apply_operation(actor_id, pending.value.operation);
        if (!applied.ok) {
            this.journal.warning(
                `Failed to apply ${pending.value.operation.what} ${pending.value.id}: ${applied.error}`,
            );
            return applied;
        }

        this.journal.info(
            `Confirmed ${pending.value.operation.what} ${pending.value.id} ` +
            `requested by ${pending.value.requested_by} confirmed by ${Helpers.actor_label(actor.value)}`,
        );
        return applied;
    }

    async reject(actor_id: string, operation_id: string): Promise<Status> {
        const actor = await this.require_admin(actor_id);
        if (!actor.ok) {
            return actor.as_status();
        }

        const pending = this.take_if_actionable(actor_id, operation_id, new Date());
        if (!pending.ok) {
            return pending.as_status();
        }

        this.journal.info(
            `Rejected ${pending.value.operation.what} ${pending.value.id} ` +
            `requested by ${pending.value.requested_by} rejected by ${Helpers.actor_label(actor.value)}`,
        );
        return Expected.ok(undefined);
    }

    protected async proceed_impl(now: Date, _interval_ms: number): Promise<Expected<void[]>> {
        for (const [id, operation] of this.pending) {
            if (operation.expires_at > now) {
                continue;
            }
            this.pending.delete(id);
            this.journal.info(
                `Expired pending ${operation.operation.what} ${id} requested by ${operation.requested_by}`,
            );
        }
        return Expected.ok([]);
    }

    private async enqueue(
        actor: UserData,
        now: Date,
        operation: AdministrationOperation,
    ): Promise<Expected<PendingOperation>> {
        const pending: PendingOperation = {
            id: crypto.randomUUID(),
            requested_by: actor.id.system_id,
            requested_at: now,
            expires_at: new Date(now.getTime() + this.confirmation_ttl_sec * 1000),
            operation,
        };
        this.pending.set(pending.id, pending);

        this.journal.info(
            `Requested ${operation.what} ${pending.id} by ${Helpers.actor_label(actor)}`,
        );
        return Expected.ok(Helpers.clone_pending(pending));
    }

    private async plan_create(
        actor_id: string,
        user: UserData,
    ): Promise<Expected<AdministrationOperation>> {
        const shape = this.validate_create_shape(user);
        if (!shape.ok) {
            return shape.cast_error<AdministrationOperation>();
        }

        // Match only tg_username. A shared name does not merge two profiles.
        if (user.id.tg_username) {
            const existing = await this.users.resolve_user({
                tg_username: user.id.tg_username
            });
            if (!existing.ok) {
                return existing.wrap_error("failed to resolve tg_username");
            }
            if (existing.value) {
                if (!is_guest_user(existing.value)) {
                    return Expected.err(
                        `tg_username '${user.id.tg_username}' is already a member, use update`,
                    );
                }
                return this.plan_promote_guest(actor_id, existing.value, user);
            }
        }

        if (is_guest_user(user)) {
            return Expected.err("resulting role set must not be empty");
        }

        return Expected.ok({
            what: "create_user",
            user: Helpers.clone_user(user),
        });
    }

    // Turn "add this telegram user" into an update that keeps system_id and the binding.
    private async plan_promote_guest(
        actor_id: string,
        existing: UserData,
        requested: UserData,
    ): Promise<Expected<AdministrationOperation>> {
        const target = Helpers.clone_user(existing);
        const desired: UserData = {
            id: { ...target.id },
            name: requested.name,
            surname: requested.surname,
            lang: requested.lang,
            voice: requested.voice,
            roles: [...requested.roles],
        };
        const patch = build_user_data_patch(target, desired);
        const after = apply_cas_patch(target, patch);
        if (!after.ok) {
            return after.wrap_error("failed to apply user patch");
        }

        const rules = await this.inspect_update(actor_id, target, after.value);
        if (!rules.ok) {
            return rules.cast_error();
        }

        this.journal.info(
            `Reusing roleless profile ${target.id.system_id} ` +
            `for tg_username '${target.id.tg_username}'`,
        );
        return Expected.ok({
            what: "update_user",
            target,
            patch,
        });
    }

    private async plan_update(
        actor_id: string,
        system_id: string,
        patch: UserCasPatch,
    ): Promise<Expected<AdministrationOperation>> {
        const preview = await this.preview_update(system_id, patch);
        if (!preview.ok) {
            return preview.cast_error<AdministrationOperation>();
        }

        const rules = await this.inspect_update(
            actor_id, preview.value.current, preview.value.after);
        if (!rules.ok) {
            return rules.cast_error<AdministrationOperation>();
        }

        return Expected.ok({
            what: "update_user",
            target: Helpers.clone_user(preview.value.current),
            patch: structuredClone(patch),
        });
    }

    private async plan_remove_member(
        actor_id: string,
        system_id: string,
    ): Promise<Expected<AdministrationOperation>> {
        if (actor_id === system_id) {
            return Expected.err("cannot remove yourself from membership");
        }

        const target = await this.users.resolve_user({ system_id });
        if (!target.ok) {
            return target.wrap_error("failed to resolve target user");
        }
        if (!target.value) {
            return Expected.err(`user '${system_id}' not found`);
        }
        if (is_guest_user(target.value)) {
            return Expected.err("user is not a member");
        }

        return Expected.ok({
            what: "remove_member",
            target: Helpers.clone_user(target.value),
        });
    }

    private async apply_operation(
        actor_id: string,
        operation: AdministrationOperation,
    ): Promise<Expected<OperationResult>> {
        switch (operation.what) {
            case "create_user":
                return this.apply_create(operation);
            case "update_user":
                return this.apply_update(actor_id, operation);
            case "remove_member":
                return this.apply_remove_member(actor_id, operation);
        }
    }

    private async apply_create(
        operation: Extract<AdministrationOperation, { what: "create_user" }>,
    ): Promise<Expected<OperationResult>> {
        const prepared = await this.prepare_create(operation.user);
        if (!prepared.ok) {
            return prepared.cast_error<OperationResult>();
        }

        const created = await this.users.create(Helpers.to_new_user(prepared.value));
        if (!created.ok) {
            return created.wrap_error("failed to create user");
        }

        return Expected.ok({
            what: "user_created",
            user: Helpers.clone_user(created.value),
        });
    }

    private async apply_update(
        actor_id: string,
        operation: Extract<AdministrationOperation, { what: "update_user" }>,
    ): Promise<Expected<OperationResult>> {
        const preview = await this.preview_update(
            operation.target.id.system_id, operation.patch);
        if (!preview.ok) {
            return preview.cast_error();
        }

        const rules = await this.inspect_update(
            actor_id, preview.value.current, preview.value.after);
        if (!rules.ok) {
            return rules.cast_error();
        }

        const updated = await this.users.update(
            operation.target.id.system_id, operation.patch);
        if (!updated.ok) {
            return updated.wrap_error("failed to update user");
        }

        return Expected.ok({
            what: "user_updated",
            before: Helpers.clone_user(preview.value.current),
            after: Helpers.clone_user(updated.value),
            patch: structuredClone(operation.patch),
        });
    }

    private async apply_remove_member(
        actor_id: string,
        operation: Extract<AdministrationOperation, { what: "remove_member" }>,
    ): Promise<Expected<OperationResult>> {
        const system_id = operation.target.id.system_id;
        if (actor_id === system_id) {
            return Expected.err("cannot remove yourself from membership");
        }

        const patch: UserCasPatch = {
            roles: {
                expected: [...operation.target.roles],
                remove: operation.target.roles.map((value, index) => ({ index, value })),
            },
        };
        const preview = await this.preview_update(system_id, patch);
        if (!preview.ok) {
            return preview.wrap_error("cannot remove member; create a new removal request");
        }

        const updated = await this.users.update(system_id, patch);
        if (!updated.ok) {
            return updated.wrap_error("failed to remove member; create a new removal request");
        }

        return Expected.ok({
            what: "member_removed",
            before: Helpers.clone_user(preview.value.current),
            after: Helpers.clone_user(updated.value),
        });
    }

    private async preview_update(
        system_id: string,
        patch: UserCasPatch,
    ): Promise<Expected<{ current: UserData, after: UserData }>> {
        const current = await this.users.resolve_user({ system_id });
        if (!current.ok) {
            return current.wrap_error("failed to resolve target user");
        }
        if (!current.value) {
            return Expected.err(`user '${system_id}' not found`);
        }

        const after = apply_cas_patch(current.value, patch);
        if (!after.ok) {
            return after.wrap_error("failed to apply user patch");
        }
        return Expected.ok({ current: current.value, after: after.value });
    }

    private validate_create_shape(user: UserData): Status {
        if (user.id.system_id !== "") {
            return Expected.err("system_id must be empty when creating a user");
        }
        if (user.id.tg_username !== undefined && user.id.tg_username.length === 0) {
            return Expected.err("tg_username must be non-empty when set");
        }
        return Expected.ok(undefined);
    }

    private async prepare_create(user: UserData): Promise<Expected<UserData>> {
        const shape = this.validate_create_shape(user);
        if (!shape.ok) {
            return shape.cast_error<UserData>();
        }
        if (is_guest_user(user)) {
            return Expected.err("resulting role set must not be empty");
        }
        if (user.id.tg_username) {
            const taken = await this.username_taken(user.id.tg_username);
            if (!taken.ok) {
                return taken.cast_error<UserData>();
            }
            if (taken.value) {
                return Expected.err(`tg_username '${user.id.tg_username}' is already used`);
            }
        }
        return Expected.ok(Helpers.clone_user(user));
    }

    private async inspect_update(
        actor_id: string,
        before: UserData,
        after: UserData,
    ): Promise<Status> {
        if (after.id.system_id !== before.id.system_id) {
            return Expected.err("cannot change system_id");
        }
        if (is_guest_user(after)) {
            return Expected.err("resulting role set must not be empty");
        }
        if (Helpers.drops_own_admin(actor_id, before.id.system_id, before.roles, after.roles)) {
            return Expected.err("cannot remove admin role from yourself");
        }
        if (before.id.tg_username && before.id.tg_username !== after.id.tg_username) {
            return Expected.err("tg_username can only be set when the user has none");
        }
        if (after.id.tg_username !== undefined && after.id.tg_username.length === 0) {
            return Expected.err("tg_username must be non-empty when set");
        }
        if (after.id.tg_username && after.id.tg_username !== before.id.tg_username) {
            const taken = await this.username_taken(
                after.id.tg_username, before.id.system_id);
            if (!taken.ok) {
                return taken.as_status();
            }
            if (taken.value) {
                return Expected.err(`tg_username '${after.id.tg_username}' is already used`);
            }
        }
        return Expected.ok(undefined);
    }

    private async require_admin(actor_id: string): Promise<Expected<UserData>> {
        const actor = await this.users.resolve_user({ system_id: actor_id });
        if (!actor.ok) {
            return actor.wrap_error<UserData>("failed to resolve actor")
                .set_error_code(AdministrationError.ActorResolveFailed);
        }
        if (!actor.value) {
            return Expected.err(`actor '${actor_id}' not found`)
                .set_error_code(AdministrationError.ActorNotFound);
        }
        if (!user_has_role(actor.value, Role.Admin)) {
            return Expected.err("actor is not an admin")
                .set_error_code(AdministrationError.ActorNotAdmin);
        }
        return Expected.ok(actor.value);
    }

    private async username_taken(
        tg_username: string,
        except_system_id?: string,
    ): Promise<Expected<boolean>> {
        const existing = await this.users.resolve_user({ tg_username });
        if (!existing.ok) {
            return existing.wrap_error("failed to resolve tg_username");
        }
        if (!existing.value) {
            return Expected.ok(false);
        }
        return Expected.ok(existing.value.id.system_id !== except_system_id);
    }

    private ensure_pending_capacity(actor_id: string, now: Date): Status {
        let count = 0;
        for (const operation of this.pending.values()) {
            if (operation.requested_by === actor_id && operation.expires_at > now) {
                count += 1;
            }
        }
        if (count >= this.max_pending_per_user) {
            return Expected.err(
                `too many pending operations (max ${this.max_pending_per_user})`,
            );
        }
        return Expected.ok(undefined);
    }

    private take_if_actionable(
        actor_id: string,
        operation_id: string,
        now: Date,
    ): Expected<PendingOperation> {
        const pending = this.pending.get(operation_id);
        if (!pending) {
            return Expected.err("pending operation not found")
                .set_error_code(AdministrationError.PendingNotFound);
        }
        if (pending.expires_at <= now) {
            this.pending.delete(operation_id);
            return Expected.err("pending operation expired")
                .set_error_code(AdministrationError.PendingExpired);
        }
        if (pending.requested_by !== actor_id) {
            return Expected.err("only the initiator can confirm or reject this operation");
        }
        this.pending.delete(operation_id);
        return Expected.ok(pending);
    }

    private drop_pending_if_initiator(actor_id: string, operation_id: string): void {
        const pending = this.pending.get(operation_id);
        if (!pending || pending.requested_by !== actor_id) {
            return;
        }
        this.pending.delete(operation_id);
        this.journal.info(
            `Dropped pending ${pending.operation.what} ${pending.id}: ` +
            `${actor_id} is not allowed to confirm`,
        );
    }
}

class Helpers {
    static to_new_user(user: UserData): NewUserData {
        return {
            name: user.name,
            surname: user.surname,
            lang: user.lang,
            voice: user.voice,
            roles: [...user.roles],
            ...(user.id.tg_username ? { tg_username: user.id.tg_username } : {}),
        };
    }

    static drops_own_admin(
        actor_id: string,
        target_id: string,
        current: Role[],
        next: Role[],
    ): boolean {
        return actor_id === target_id
            && current.includes(Role.Admin)
            && !next.includes(Role.Admin);
    }

    static clone_user(user: UserData): UserData {
        return {
            id: { ...user.id },
            name: user.name,
            surname: user.surname,
            lang: user.lang,
            voice: user.voice,
            roles: [...user.roles],
        };
    }

    static clone_pending(operation: PendingOperation): PendingOperation {
        return {
            id: operation.id,
            requested_by: operation.requested_by,
            requested_at: new Date(operation.requested_at),
            expires_at: new Date(operation.expires_at),
            operation: Helpers.clone_operation(operation.operation),
        };
    }

    static clone_operation(operation: AdministrationOperation): AdministrationOperation {
        if (operation.what === "create_user") {
            return {
                what: "create_user",
                user: Helpers.clone_user(operation.user),
            };
        }
        if (operation.what === "remove_member") {
            return {
                what: "remove_member",
                target: Helpers.clone_user(operation.target),
            };
        }
        return {
            what: "update_user",
            target: Helpers.clone_user(operation.target),
            patch: structuredClone(operation.patch),
        };
    }

    static actor_label(actor: UserData): string {
        return actor.id.tg_username ?? actor.id.system_id;
    }
}
