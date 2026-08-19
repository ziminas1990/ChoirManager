import assert from "assert";

import { DocumentData } from "@google-cloud/firestore";

import { FirestoreValidatingConverter } from "@src/adapters/plain_collection/firestore_converter.js";
import { UserData } from "@src/entities/user.js";
import { UserPatch } from "@src/interfaces/user_service.js";
import { Expected } from "@src/utils/expected.js";
import { apply_cas_patch } from "@src/utils/patching.js";
import { UserRecord } from "./user_record.js";
import {
    parse_language,
    parse_roles,
    parse_voice,
    validate_user_record,
} from "./user_validator.js";

type UserStoredRecord = {
    schema?: 1;
    id?: string;
    revision?: number;
    tg_username?: string;
    name: string;
    surname: string;
    lang: string;
    voice: string;
    roles: string[];
}

export function to_record(source: UserRecord): UserStoredRecord {
    return {
        schema: 1,
        id: source.id,
        revision: source.revision,
        ...(source.tg_username ? { tg_username: source.tg_username } : {}),
        name: source.name,
        surname: source.surname,
        lang: source.lang,
        voice: source.voice,
        roles: source.roles,
    };
}

export function to_entity(record: UserStoredRecord, doc_id: string): UserRecord {
    const latest = to_latest_version(record);
    assert(latest.schema === 1);

    return {
        id: latest.id ?? doc_id,
        revision: latest.revision ?? 0,
        ...(latest.tg_username ? { tg_username: latest.tg_username } : {}),
        name: latest.name,
        surname: latest.surname,
        lang: latest.lang,
        voice: latest.voice,
        roles: latest.roles,
    };
}

export function to_latest_version(record: UserStoredRecord): UserStoredRecord {
    if (record.schema == undefined) {
        return { ...record, schema: 1 };
    }
    return record;
}

export function from_user_data(user: UserData, revision: number): UserRecord {
    return {
        id: user.id.system_id,
        revision,
        ...(user.id.tg_username ? { tg_username: user.id.tg_username } : {}),
        name: user.name,
        surname: user.surname,
        lang: user.lang,
        voice: user.voice,
        roles: user.roles,
    };
}

export function apply_user_patch(existing: UserData, patch: UserPatch): Expected<UserData> {
    if (patch.id?.system_id !== undefined) {
        return Expected.err("cannot change system_id");
    }
    return apply_cas_patch(existing, patch);
}

// Nested UserId is assembled here; it is not stored in Firestore.
export function to_user_data(record: UserRecord): Expected<UserData> {
    const lang = parse_language(record.lang);
    if (!lang.ok) {
        return lang.cast_error();
    }
    const voice = parse_voice(record.voice);
    if (!voice.ok) {
        return voice.cast_error();
    }
    const roles = parse_roles(record.roles);
    if (!roles.ok) {
        return roles.cast_error();
    }

    return Expected.ok({
        id: {
            system_id: record.id,
            ...(record.tg_username ? { tg_username: record.tg_username } : {}),
        },
        name: record.name,
        surname: record.surname,
        lang: lang.value,
        voice: voice.value,
        roles: roles.value,
    });
}

export function user_firestore_converter()
: FirestoreValidatingConverter<UserRecord>
{
    return new FirestoreValidatingConverter<UserRecord>(
        validate_user_record,
        (data) => to_record(data),
        (data: DocumentData, doc_id: string) => to_entity(data as UserStoredRecord, doc_id),
    );
}
