import { UserData } from "@src/entities/user.js";
import { UserPatch } from "@src/interfaces/user_service.js";
import { Expected, Status } from "@src/utils/expected.js";

export type UserCasPatch = UserPatch;

export type AdministrationOperation = {
    what: "create_user";
    user: UserData;
} | {
    what: "update_user";
    system_id: string;
    patch: UserCasPatch;
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
};

export type PendingOperation = {
    id: string;
    requested_by: string;
    requested_at: Date;
    expires_at: Date;
    operation: AdministrationOperation;
};

export type AdministrationEvent = {
    what: "confirmation_requested";
    request: PendingOperation;
};

// Service logic: admin ACL, confirmation, and apply. Events go via IBroadcaster.
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

    confirm(actor_id: string, operation_id: string): Promise<Expected<OperationResult>>;

    reject(actor_id: string, operation_id: string): Promise<Status>;
}
