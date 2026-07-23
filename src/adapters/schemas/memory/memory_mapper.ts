import assert from "assert";

import { MemoryFact } from "@src/entities/memory.js";
import { MemoryFactRecord } from "./memory_record.js";

export function to_record(source: MemoryFact): MemoryFactRecord {
    return {
        schema: 1,
        id: source.id,
        created_at: source.created_at,
        author_user_id: source.author_user_id,
        content: source.content,
        visibility: source.visibility,
    };
}

export function to_entity(record: MemoryFactRecord): MemoryFact {
    const latest = to_latest_version(record);
    assert(latest.schema === 1);

    return {
        id: latest.id,
        created_at: latest.created_at,
        author_user_id: latest.author_user_id,
        content: latest.content,
        visibility: latest.visibility,
    };
}

export function to_latest_version(record: MemoryFactRecord): MemoryFactRecord {
    return record;
}
