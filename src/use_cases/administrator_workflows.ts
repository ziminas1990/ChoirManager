import { Environment } from "@src/components/environment.js";
import { Language, Role, UserData, UserFields, Voice } from "@src/entities/user.js";
import {
    AdministrationError,
    IAdministrationService,
    PendingOperation,
    UserCasPatch,
} from "@src/interfaces/administration_service.js";
import { ConfirmationError, IUserAgent } from "@src/interfaces/user_agent.js";
import { IUserService } from "@src/interfaces/user_service.js";
import { Journal } from "@src/journal.js";
import { Expected, Status } from "@src/utils/expected.js";
import { return_fail } from "@src/utils.js";
import {
    render_confirmation,
    render_failure,
    render_rejected,
    render_result,
    render_timeout,
} from "@src/utils/string_engine/administration.js";

const PENDING_ALREADY_GONE = [
    AdministrationError.PendingNotFound,
    AdministrationError.PendingExpired,
];

export class AdministratorWorkflows {

    // Creates a pending create request and returns it. Confirmation runs separately.
    static async request_create_user(
        env: {
            agent: IUserAgent;
            admin_svc?: IAdministrationService;
        },
        fields: UserFields,
        roles: Role[],
        journal: Journal,
    ): Promise<Expected<PendingOperation>> {
        const wf = journal.child("request_create_user");
        const agent = env.agent;
        wf.log().info(`started by ${agent.userid()}`);

        const admin_svc = env.admin_svc
            ?? Environment.global.maybe_administration_service;
        if (!admin_svc) {
            return return_fail("administration service is not configured", wf.log());
        }

        const pending = await admin_svc.request_create_user(
            agent.userid(),
            Helpers.to_new_user(fields, roles),
        );
        if (!pending.ok) {
            wf.log().error(`request_create_user failed: ${pending.error}`);
            return pending.cast_error();
        }
        wf.log().info(`pending created: ${pending.value.id}`);
        return pending;
    }

    // Creates a pending update request and returns it. Confirmation runs separately.
    static async request_update_user(
        env: {
            agent: IUserAgent;
            admin_svc?: IAdministrationService;
            user_svc?: IUserService;
        },
        system_id: string,
        fields: UserFields,
        add_roles: Role[],
        remove_roles: Role[],
        journal: Journal,
    ): Promise<Expected<PendingOperation>> {
        const wf = journal.child("request_update_user");
        const agent = env.agent;
        wf.log().info(`started by ${agent.userid()} for ${system_id}`);

        const admin_svc = env.admin_svc
            ?? Environment.global.maybe_administration_service;
        if (!admin_svc) {
            return return_fail("administration service is not configured", wf.log());
        }
        const user_svc = env.user_svc ?? Environment.global.maybe_user_service;
        if (!user_svc) {
            return return_fail("user service is not configured", wf.log());
        }

        const current = await user_svc.resolve_user({ system_id });
        if (!current.ok) {
            wf.log().error(`failed to resolve target user '${system_id}': ${current.error}`);
            return current.wrap_error("failed to resolve target user");
        }
        if (!current.value) {
            wf.log().error(`user '${system_id}' not found`);
            return Expected.err(`user '${system_id}' not found`);
        }

        const patch = Helpers.build_update_patch(
            current.value, fields, add_roles, remove_roles);
        if (!patch.ok) {
            wf.log().error(`failed to build update patch for '${system_id}': ${patch.error}`);
            return patch.cast_error();
        }

        const pending = await admin_svc.request_update_user(
            agent.userid(),
            system_id,
            patch.value,
        );
        if (!pending.ok) {
            wf.log().error(`request_update_user failed: ${pending.error}`);
            return pending.cast_error();
        }
        wf.log().info(`pending created: ${pending.value.id}`);
        return pending;
    }

    // Asks for confirmation, applies or rejects the request, and tells the admin
    // whether it was applied, rejected, expired, or failed.
    static async run_confirmation(
        pending: PendingOperation,
        agent: IUserAgent,
        admin_svc: IAdministrationService,
        journal: Journal,
    ): Promise<Status> {
        const wf = journal.child("run_confirmation");
        wf.log().info(
            `started for ${pending.id} (${pending.operation.what}) by ${agent.userid()}`,
        );

        try {
            const decision = await AdministratorWorkflows.ask_confirmation(pending, agent);
            if (!decision.ok) {
                if (decision.is_error(ConfirmationError.TimedOut)) {
                    wf.log().warn(
                        `confirmation timed out for ${pending.id}: ${decision.error}`);
                    const rejected = await admin_svc.reject(agent.userid(), pending.id);
                    if (!rejected.ok && !rejected.is_error(PENDING_ALREADY_GONE)) {
                        wf.log().error(
                            `reject after timeout failed for ${pending.id}: ${rejected.error}`);
                        return await AdministratorWorkflows.report(
                            agent, render_failure(rejected.error), wf);
                    }
                    if (!rejected.ok) {
                        wf.log().info(
                            `pending ${pending.id} already gone after timeout: ${rejected.error}`);
                    }
                    return await AdministratorWorkflows.report(agent, render_timeout(), wf);
                }

                wf.log().error(
                    `confirmation prompt failed for ${pending.id}: ${decision.error}`,
                );
                await AdministratorWorkflows.drop_pending(admin_svc, pending, wf);
                return await AdministratorWorkflows.report(
                    agent, render_failure(decision.error), wf);
            }

            wf.log().info(`admin decision for ${pending.id}: ${decision.value}`);

            if (decision.value === "negative") {
                const rejected = await admin_svc.reject(agent.userid(), pending.id);
                if (!rejected.ok) {
                    wf.log().error(`reject failed for ${pending.id}: ${rejected.error}`);
                    return await AdministratorWorkflows.report(
                        agent, render_failure(rejected.error), wf);
                }
                wf.log().info(`pending ${pending.id} rejected by admin`);
                return await AdministratorWorkflows.report(agent, render_rejected(), wf);
            }

            const applied = await admin_svc.confirm(agent.userid(), pending.id);
            if (!applied.ok) {
                wf.log().error(`confirm failed for ${pending.id}: ${applied.error}`);
                return await AdministratorWorkflows.report(
                    agent, render_failure(applied.error), wf);
            }
            wf.log().info(`${pending.operation.what} completed: ${pending.id}`);
            return await AdministratorWorkflows.report(
                agent, render_result(applied.value), wf);
        } catch (error) {
            wf.log().error(error, `confirmation workflow crashed for ${pending.id}`);
            await AdministratorWorkflows.drop_pending(admin_svc, pending, wf);
            const reason = error instanceof Error ? error.message : String(error);
            return await AdministratorWorkflows.report(agent, render_failure(reason), wf);
        }
    }

    // Asks the admin to confirm or reject a pending operation.
    // Timeout and prompt failures stay as Expected errors.
    private static async ask_confirmation(
        pending: PendingOperation,
        agent: IUserAgent,
    ): Promise<Expected<"positive" | "negative">> {
        return await agent.ask_confirmation(
            render_confirmation(pending.operation),
            "✅ Confirm",
            "❌ Reject",
            Helpers.button_lifetime_sec(pending),
        );
    }

    private static async report(
        agent: IUserAgent,
        message: string,
        journal: Journal,
    ): Promise<Status> {
        const sent = await agent.send_message(message);
        if (!sent.ok) {
            journal.log().error(`failed to send administration outcome: ${sent.error}`);
            return sent.wrap_error("failed to send administration outcome").as_status();
        }
        return Expected.ok(undefined);
    }

    private static async drop_pending(
        service: IAdministrationService,
        pending: PendingOperation,
        journal: Journal,
    ): Promise<void> {
        const rejected = await service.reject(pending.requested_by, pending.id);
        if (rejected.ok) {
            return;
        }
        if (!rejected.is_error(PENDING_ALREADY_GONE)) {
            journal.log().warn(`reject failed for ${pending.id}: ${rejected.error}`);
        }
    }
}

class Helpers {

    static to_new_user(fields: UserFields, roles: Role[]): UserData {
        return {
            id: {
                system_id: "",
                ...(fields.tg_username ? { tg_username: fields.tg_username } : {}),
            },
            name: fields.name ?? "",
            surname: fields.surname ?? "",
            lang: fields.lang ?? Language.EN,
            voice: fields.voice ?? Voice.Unknown,
            roles: [...roles],
        };
    }

    static build_update_patch(
        current: UserData,
        fields: UserFields,
        add_roles: Role[],
        remove_roles: Role[],
    ): Expected<UserCasPatch> {
        const add_set = new Set(add_roles);
        const remove_set = new Set(remove_roles);
        for (const role of add_set) {
            if (remove_set.has(role)) {
                return Expected.err(`role '${role}' is both added and removed`);
            }
        }

        const patch: UserCasPatch = {};
        if (fields.name !== undefined && fields.name !== current.name) {
            patch.name = [current.name, fields.name];
        }
        if (fields.surname !== undefined && fields.surname !== current.surname) {
            patch.surname = [current.surname, fields.surname];
        }
        if (fields.lang !== undefined && fields.lang !== current.lang) {
            patch.lang = [current.lang, fields.lang];
        }
        if (fields.voice !== undefined && fields.voice !== current.voice) {
            patch.voice = [current.voice, fields.voice];
        }

        if (fields.tg_username !== undefined && fields.tg_username !== current.id.tg_username) {
            patch.id = {
                tg_username: [current.id.tg_username, fields.tg_username],
            };
        }

        const remove: { index: number, value: Role }[] = [];
        for (const role of remove_set) {
            const index = current.roles.indexOf(role);
            if (index < 0) {
                continue;
            }
            remove.push({ index, value: role });
        }

        const append: Role[] = [];
        for (const role of add_set) {
            if (!current.roles.includes(role)) {
                append.push(role);
            }
        }

        if (remove.length > 0 || append.length > 0) {
            patch.roles = {
                ...(remove.length > 0 ? { remove } : {}),
                ...(append.length > 0 ? { append } : {}),
            };
        }

        if (!Helpers.has_changes(patch)) {
            return Expected.err("nothing to change");
        }
        return Expected.ok(patch);
    }

    static button_lifetime_sec(pending: PendingOperation): number {
        const remaining_ms = pending.expires_at.getTime() - Date.now();
        return Math.max(1, Math.ceil(remaining_ms / 1000));
    }

    static has_changes(patch: UserCasPatch): boolean {
        return patch.name !== undefined
            || patch.surname !== undefined
            || patch.lang !== undefined
            || patch.voice !== undefined
            || patch.id !== undefined
            || patch.roles !== undefined;
    }
}
