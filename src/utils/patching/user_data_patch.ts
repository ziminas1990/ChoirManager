import { UserData } from "@src/entities/user.js";
import { UserPatch } from "@src/interfaces/user_service.js";
import { build_array_cas_patch } from "@src/utils/cas_patch.js";

// Field and role changes only. Identity (system_id and telegram binding) stays.
export function build_user_data_patch(before: UserData, after: UserData): UserPatch {
    const patch: UserPatch = {};
    if (before.name !== after.name) {
        patch.name = [before.name, after.name];
    }
    if (before.surname !== after.surname) {
        patch.surname = [before.surname, after.surname];
    }
    if (before.lang !== after.lang) {
        patch.lang = [before.lang, after.lang];
    }
    if (before.voice !== after.voice) {
        patch.voice = [before.voice, after.voice];
    }

    const roles_patch = build_array_cas_patch(before.roles, after.roles);
    if (Object.keys(roles_patch).length > 0) {
        patch.roles = roles_patch;
    }
    return patch;
}
