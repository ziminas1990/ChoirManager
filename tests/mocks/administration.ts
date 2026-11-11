import { IAdministrationService } from "@src/interfaces/administration_service.js";

import { unexpected } from "./unexpected.js";

export function mock_administration(overrides: Partial<IAdministrationService> = {}): IAdministrationService {
    return {
        request_create_user: unexpected,
        request_update_user: unexpected,
        request_remove_member: unexpected,
        confirm: unexpected,
        reject: unexpected,
        ...overrides,
    };
}
