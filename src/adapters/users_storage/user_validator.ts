import { Language, Role, Voice } from "@src/entities/user.js";
import { Expected, Status } from "@src/utils/expected.js";
import { UserRecord } from "./user_record.js";

const LANGUAGES = new Set<string>(Object.values(Language));
const VOICES = new Set<string>(Object.values(Voice));
const ROLES = new Set<string>(Object.values(Role));

export function parse_language(value: string): Expected<Language> {
    if (!LANGUAGES.has(value)) {
        return Expected.err(`unknown lang '${value}'`);
    }
    return Expected.ok(value as Language);
}

export function parse_voice(value: string): Expected<Voice> {
    if (!VOICES.has(value)) {
        return Expected.err(`unknown voice '${value}'`);
    }
    return Expected.ok(value as Voice);
}

export function parse_roles(values: string[]): Expected<Role[]> {
    if (!Array.isArray(values)) {
        return Expected.err("roles must be an array");
    }
    const roles: Role[] = [];
    for (const role of values) {
        if (role === "guest") {  // deprecated role, remove later
            continue;
        }
        if (!ROLES.has(role)) {
            return Expected.err(`unknown role '${role}'`);
        }
        roles.push(role as Role);
    }
    return Expected.ok(roles);
}

export function validate_user_record(item: UserRecord): Status {
    if (!item.id) {
        return Expected.err("id is required");
    }
    if (typeof item.revision !== "number") {
        return Expected.err("revision is required");
    }
    if (typeof item.name !== "string") {
        return Expected.err("name is required");
    }
    if (typeof item.surname !== "string") {
        return Expected.err("surname is required");
    }
    if (item.tg_username !== undefined) {
        if (typeof item.tg_username !== "string") {
            return Expected.err("tg_username must be a string");
        }
        if (item.tg_username.length === 0) {
            return Expected.err("tg_username must be non-empty when set");
        }
    }

    const lang = parse_language(item.lang);
    if (!lang.ok) {
        return lang.as_status();
    }
    const voice = parse_voice(item.voice);
    if (!voice.ok) {
        return voice.as_status();
    }
    const roles = parse_roles(item.roles);
    if (!roles.ok) {
        return roles.as_status();
    }
    return Expected.ok(undefined);
}
