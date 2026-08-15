import assert from "assert";

import { DocumentData } from "@google-cloud/firestore";

import { FirestoreValidatingConverter } from "@src/adapters/plain_collection/firestore_converter.js";
import { Expected, Status } from "@src/utils/expected.js";
import { TelegramUserRecord } from "./telegram_user_record.js";

type TelegramUserStoredRecord = {
    schema?: 1;
    id?: string;
    revision?: number;
    user_id: string;
    telegram_username: string;
    telegram_id: number;
    private_chat_id: number;
}

export function to_record(source: TelegramUserRecord): TelegramUserStoredRecord {
    return {
        schema: 1,
        id: source.id,
        revision: source.revision,
        user_id: source.user_id,
        telegram_username: source.telegram_username,
        telegram_id: source.telegram_id,
        private_chat_id: source.private_chat_id,
    };
}

export function to_entity(record: TelegramUserStoredRecord, doc_id: string): TelegramUserRecord {
    const latest = to_latest_version(record);
    assert(latest.schema === 1);

    return {
        id: latest.id ?? doc_id,
        revision: latest.revision ?? 0,
        user_id: latest.user_id,
        telegram_username: latest.telegram_username,
        telegram_id: latest.telegram_id,
        private_chat_id: latest.private_chat_id,
    };
}

// Upgrade older stored schemas one version at a time until the latest.
export function to_latest_version(record: TelegramUserStoredRecord): TelegramUserStoredRecord {
    if (record.schema == undefined) {
        return { ...record, schema: 1 };
    }
    return record;
}

export function validate_telegram_user_record(item: TelegramUserRecord): Status {
    if (!item.id) {
        return Expected.err("id is required");
    }
    if (typeof item.revision !== "number") {
        return Expected.err("revision is required");
    }
    if (!item.user_id) {
        return Expected.err("user_id is required");
    }
    if (!item.telegram_username) {
        return Expected.err("telegram_username is required");
    }
    if (typeof item.telegram_id !== "number") {
        return Expected.err("telegram_id is required");
    }
    if (typeof item.private_chat_id !== "number") {
        return Expected.err("private_chat_id is required");
    }
    return Expected.ok(undefined);
}

export function telegram_user_firestore_converter()
: FirestoreValidatingConverter<TelegramUserRecord>
{
    return new FirestoreValidatingConverter<TelegramUserRecord>(
        validate_telegram_user_record,
        (data) => to_record(data),
        (data: DocumentData, doc_id: string) => to_entity(data as TelegramUserStoredRecord, doc_id),
    );
}
