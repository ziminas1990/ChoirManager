import { CollectionReference, Firestore } from "@google-cloud/firestore";

import { to_entity, to_record } from "@src/adapters/schemas/memory/memory_mapper.js";
import { MemoryFactRecord } from "@src/adapters/schemas/memory/memory_record.js";
import { GoogleAuth } from "@src/api/google_auth.js";
import {
    MemoryFact,
    MemoryVisibility,
    NewMemoryFact,
} from "@src/entities/memory.js";
import { ISimpleMemoryStorage } from "@src/interfaces/simple_memory.js";
import { Journal } from "@src/journal.js";
import { Expected } from "@src/utils/expected.js";
import { generate_memory_id } from "@src/utils/misc.js";
import { TokenBucket } from "@src/utils/token_bucket.js";

export type Config = {
    database_id: string;
    collection_name: string;
};

const MAX_ID_COLLISION_RETRIES = 10;

type FirestoreTimestamp = {
    _seconds: number;
};

function parse_timestamp(value: unknown): Date | undefined {
    if (value == undefined) {
        return undefined;
    }
    if (value instanceof Date) {
        return value;
    }
    if (typeof value === "object" && value !== null && "_seconds" in value) {
        return new Date((value as FirestoreTimestamp)._seconds * 1000);
    }
    return undefined;
}

function get_required_string(value: unknown): string | undefined {
    if (typeof value !== "string") {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

function parse_visibility(value: unknown): Expected<MemoryVisibility> {
    if (typeof value !== "object" || value === null) {
        return Expected.err("visibility must be an object");
    }

    const raw = value as Record<string, unknown>;
    switch (raw.kind) {
        case "global":
            return Expected.ok({ kind: "global" });
        case "specific_user": {
            const user_id = get_required_string(raw.user_id);
            if (!user_id) {
                return Expected.err("specific_user visibility is missing user_id");
            }
            return Expected.ok({ kind: "specific_user", user_id });
        }
        case "specific_group": {
            const group_id = get_required_string(raw.group_id);
            if (!group_id) {
                return Expected.err("specific_group visibility is missing group_id");
            }
            return Expected.ok({ kind: "specific_group", group_id });
        }
        default:
            return Expected.err("unknown visibility kind");
    }
}

function try_parse_document(doc_id: string, data: Record<string, unknown>): Expected<MemoryFact> {
    const id = get_required_string(data.id) ?? doc_id;
    const schema = typeof data.schema === "number" ? data.schema : undefined;
    if (schema == undefined) {
        return Expected.err(`memory '${id}' is missing schema`);
    }

    const created_at = parse_timestamp(data.created_at);
    if (!created_at) {
        return Expected.err(`memory '${id}' has invalid created_at`);
    }

    const author_user_id = get_required_string(data.author_user_id);
    if (!author_user_id) {
        return Expected.err(`memory '${id}' is missing author_user_id`);
    }

    const content = get_required_string(data.content);
    if (!content) {
        return Expected.err(`memory '${id}' is missing content`);
    }

    const visibility = parse_visibility(data.visibility);
    if (!visibility.ok) {
        return visibility.cast_error<MemoryFact>().wrap_error(`memory '${id}' has invalid visibility`);
    }

    // Only schema 1 exists today; mapper upgrades when new versions appear.
    if (schema !== 1) {
        return Expected.err(`memory '${id}' has unsupported schema ${schema}`);
    }

    const record: MemoryFactRecord = {
        schema: 1,
        id,
        created_at,
        author_user_id,
        content,
        visibility: visibility.value,
    };

    return Expected.ok(to_entity(record));
}

export class GoogleFirestoreSimpleMemoryStorage implements ISimpleMemoryStorage {
    private readonly db: Firestore;
    private readonly collection: CollectionReference;
    private readonly journal: Journal;
    private readonly api_tokens: TokenBucket;

    constructor(
        private readonly config: Config,
        parent_journal: Journal,
    ) {
        this.db = GoogleAuth.get_firestore(this.config.database_id);
        this.collection = this.db.collection(this.config.collection_name);
        this.journal = parent_journal.child("simple_memory_storage");
        this.api_tokens = new TokenBucket({
            max_tokens: 50,
            refill_rate: 3,
        });
    }

    async create(fact: NewMemoryFact): Promise<Expected<MemoryFact>> {
        const created_at = new Date();
        const id_status = await this.generate_id(created_at);
        if (!id_status.ok) {
            return id_status.cast_error<MemoryFact>();
        }

        const created_fact: MemoryFact = {
            ...fact,
            id: id_status.value,
            created_at,
        };

        try {
            await this.api_tokens.wait_tokens(1);
            await this.collection.doc(created_fact.id).create(to_record(created_fact));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return Expected.err(message).wrap_error(`failed to create memory '${created_fact.id}'`);
        }

        const stored = await this.get(created_fact.id);
        if (!stored.ok) {
            return stored.cast_error<MemoryFact>().wrap_error("failed to read created memory");
        }
        return Expected.ok(stored.value);
    }

    async update(fact: MemoryFact): Promise<Expected<MemoryFact>> {
        const existing = await this.get(fact.id);
        if (!existing.ok) {
            return existing;
        }

        try {
            await this.api_tokens.wait_tokens(1);
            await this.collection.doc(fact.id).set(to_record(fact));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return Expected.err(message).wrap_error(`failed to update memory '${fact.id}'`);
        }

        const stored = await this.get(fact.id);
        if (!stored.ok) {
            return stored.cast_error<MemoryFact>().wrap_error("failed to read updated memory");
        }
        return Expected.ok(stored.value);
    }

    async delete(id: string): Promise<Expected<MemoryFact>> {
        const existing = await this.get(id);
        if (!existing.ok) {
            return existing;
        }

        try {
            await this.api_tokens.wait_tokens(1);
            await this.collection.doc(id).delete();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return Expected.err(message).wrap_error(`failed to delete memory '${id}'`);
        }

        return Expected.ok(existing.value);
    }

    async get(id: string): Promise<Expected<MemoryFact>> {
        try {
            await this.api_tokens.wait_tokens(1);
            const doc = await this.collection.doc(id).get();
            if (!doc.exists) {
                return Expected.err(`memory document '${id}' not found`);
            }
            return try_parse_document(id, doc.data() as Record<string, unknown>);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return Expected.err(message).wrap_error(`failed to read memory document '${id}'`);
        }
    }

    async fetch_all(): Promise<Expected<MemoryFact[]>> {
        try {
            await this.api_tokens.wait_tokens(1);
            const snapshot = await this.collection.get();
            const facts: MemoryFact[] = [];
            let invalid_docs = 0;

            snapshot.forEach((doc) => {
                const parsed = try_parse_document(doc.id, doc.data());
                if (!parsed.ok) {
                    invalid_docs++;
                    this.journal.log().warn(
                        `Failed to parse memory document '${doc.id}': ${parsed.error}`,
                    );
                    return;
                }
                facts.push(parsed.value);
            });

            if (invalid_docs > 0) {
                this.journal.log().warn(`Skipped ${invalid_docs} invalid memory documents`);
            }

            this.journal.log().info(`Fetched ${facts.length} memory facts from Firestore`);
            return Expected.ok(facts);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return Expected.err(message).wrap_error("failed to fetch memory facts from Firestore");
        }
    }

    private async generate_id(created_at: Date): Promise<Expected<string>> {
        for (let attempt = 0; attempt < MAX_ID_COLLISION_RETRIES; attempt++) {
            const id = generate_memory_id(created_at);
            try {
                await this.api_tokens.wait_tokens(1);
                const doc = await this.collection.doc(id).get();
                if (!doc.exists) {
                    return Expected.ok(id);
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return Expected.err(message).wrap_error("failed to check memory id uniqueness");
            }
        }

        return Expected.err("failed to generate a unique memory id");
    }
}
