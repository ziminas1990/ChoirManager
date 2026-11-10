import crypto from "crypto";

import { Expected, Status } from "@src/utils/expected.js";
import { IMessagesBacklog, Message } from "@src/interfaces/messages_backlog.js";
import { CollectionReference, DocumentData, Firestore } from "@google-cloud/firestore";
import { to_entity, to_record } from "@src/adapters/schemas/message/message_mapper.js";
import { MessageRecord } from "@src/adapters/schemas/message/message_record.js";
import { GoogleAuth } from "@src/api/google_auth.js";
import { TokenBucket } from "@src/utils/token_bucket.js";

export type Config = {
    database_id: string,
    collection_name: string,
}

function message_id_to_doc_id(message_id: string): string {
    const hash = crypto.createHash('sha1');
    hash.update(message_id);
    const hashBuffer = hash.digest();
    const hashArray = Array.from(hashBuffer).slice(0, 12);
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export class GoogleFirestore implements IMessagesBacklog {

    private db: Firestore;
    private collection: CollectionReference;
    // Limit API calls rate
    private api_tokens: TokenBucket;

    constructor(private config: Config, private read_only: boolean)
    {
        this.db = GoogleAuth.get_firestore(this.config.database_id);
        this.collection = this.db.collection(this.config.collection_name);
        this.api_tokens = new TokenBucket({
            max_tokens: 6,
            refill_rate: 2  // not more than 2 API calls per second
        });
    }

    async init(): Promise<Status> {
        return Expected.ok(undefined);
    }

    async add_message(message: Message): Promise<Status> {
        const doc_id = message_id_to_doc_id(message.message_id);
        try {
            if (this.read_only) {
                return Expected.err("Read-only mode");
            }
            await this.api_tokens.wait_tokens(1);
            await this.collection.doc(doc_id).create(to_record(message));
        } catch (error) {
            return (((error) instanceof Error) ? Expected.err((error).message) : Expected.err(String(error)));
        }
        return Expected.ok(undefined);
    }

    async update_message(message: Message): Promise<Status> {
        const doc_id = message_id_to_doc_id(message.message_id);
        try {
            if (this.read_only) {
                return Expected.err("Read-only mode");
            }
            const record = to_record(message);
            await this.api_tokens.wait_tokens(1);
            await this.collection.doc(doc_id).update({
                // Text edits must preserve the original reply metadata, even if
                // the edit event has no reply metadata.
                text: record.text,
            });
        } catch (error) {
            return (((error) instanceof Error) ? Expected.err((error).message) : Expected.err(String(error)));
        }
        return Expected.ok(undefined);
    }

    async get_messages(from: Date, to: Date): Promise<Expected<Message[]>> {
        try {
            await this.api_tokens.wait_tokens(1);
            const messages = await this.collection
                .where("time", ">=", from)
                .where("time", "<=", to)
                .orderBy("time", "asc")
                .get();
            const result: Message[] = [];

            messages.forEach((doc) => {
                result.push(to_entity(Helpers.read_record(doc.data())));
            });
            return Expected.ok(result);
        } catch (error) {
            return (((error) instanceof Error) ? Expected.err((error).message) : Expected.err(String(error)));
        }
    }

    async get_messages_by_ids(ids: string[]): Promise<Expected<Message[]>> {
        const unique_ids = [...new Set(ids)];
        const result: Message[] = [];
        try {
            for (let offset = 0; offset < unique_ids.length; offset += 100) {
                const refs = unique_ids.slice(offset, offset + 100)
                    .map(id => this.collection.doc(message_id_to_doc_id(id)));
                await this.api_tokens.wait_tokens(1);
                const documents = await this.db.getAll(...refs);
                for (const document of documents) {
                    if (document.exists) {
                        result.push(to_entity(Helpers.read_record(document.data()!)));
                    }
                }
            }
            return Expected.ok(result);
        } catch (error) {
            return Expected.exception("failed to fetch messages by IDs", error);
        }
    }
}

class Helpers {
    static read_record(data: DocumentData): MessageRecord {
        return {
            ...data,
            time: data.time.toDate(),
        } as MessageRecord;
    }
}
