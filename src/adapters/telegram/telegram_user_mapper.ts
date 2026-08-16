import assert from "assert";

import { DocumentData } from "@google-cloud/firestore";

import { FirestoreValidatingConverter } from "@src/adapters/plain_collection/firestore_converter.js";
import { TelegramUserRecord } from "./telegram_user_record.js";
import { validate_telegram_user_record } from "./telegram_user_validator.js";

type TelegramUserStoredRecord = {
    schema?: 1;
    id?: string;
    revision?: number;
    user_id: string;
    telegram_username: string;
    private_chat_id: number;
}

export function to_record(source: TelegramUserRecord): TelegramUserStoredRecord {
    return {
        schema: 1,
        id: source.id,
        revision: source.revision,
        user_id: source.user_id,
        telegram_username: source.telegram_username,
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
        private_chat_id: latest.private_chat_id,
    };
}

export function to_latest_version(record: TelegramUserStoredRecord): TelegramUserStoredRecord {
    if (record.schema == undefined) {
        return { ...record, schema: 1 };
    }
    return record;
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
