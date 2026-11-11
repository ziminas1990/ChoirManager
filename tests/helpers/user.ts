import { Language, UserData, Voice } from "@src/entities/user.js";

export function user_profile(id: string, overrides: Partial<UserData> = {}): UserData {
    return { id: { system_id: id, tg_username: id }, name: "Member", surname: "Singer",
        lang: Language.EN, voice: Voice.Alto, roles: [], ...overrides };
}
