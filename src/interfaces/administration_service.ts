import { UserData } from "@src/entities/user.js";
import { UserPatch } from "@src/interfaces/user_service.js";
import { Expected, Status } from "@src/utils/expected.js";

// Codes on errors returned by IAdministrationService.
export enum AdministrationError {
    ActorResolveFailed = 1,
    ActorNotFound,
    ActorNotAdmin,
    PendingNotFound,
    PendingExpired,
}

export type UserCasPatch = UserPatch;

export type AdministrationOperation = {
    what: "create_user";
    user: UserData;
} | {
    what: "update_user";
    // Profile captured when the request was created. Display and CAS use it.
    target: UserData;
    patch: UserCasPatch;
} | {
    what: "remove_member";
    // Profile and roles captured for confirmation and application checks.
    target: UserData;
};

export type OperationResult =
{
    what: "user_created";
    user: UserData;
} | {
    what: "user_updated";
    before: UserData;
    after: UserData;
    patch: UserCasPatch;
} | {
    what: "member_removed";
    before: UserData;
    after: UserData;
};

export type PendingOperation = {
    id: string;
    requested_by: string;
    requested_at: Date;
    expires_at: Date;
    operation: AdministrationOperation;
};

// Service logic: admin ACL, confirmation, and apply. No callbacks or event bus.
export interface IAdministrationService {

    request_create_user(
        actor_id: string,
        user: UserData,
    ): Promise<Expected<PendingOperation>>;

    request_update_user(
        actor_id: string,
        system_id: string,
        patch: UserCasPatch,
    ): Promise<Expected<PendingOperation>>;

    request_remove_member(
        actor_id: string,
        system_id: string,
    ): Promise<Expected<PendingOperation>>;

    confirm(actor_id: string, operation_id: string): Promise<Expected<OperationResult>>;

    reject(actor_id: string, operation_id: string): Promise<Status>;
}
