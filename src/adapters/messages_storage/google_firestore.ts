import crypto from "crypto";

import { Expected, Status } from "@src/utils/expected.js";
import { IMessagesBacklog, Message } from "@src/interfaces/messages_backlog.js";
import { CollectionReference, Firestore } from "@google-cloud/firestore";
import { GoogleAuth } from "@src/api/google_auth";

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

    constructor(private config: Config, private read_only: boolean)
    {
        this.db = GoogleAuth.get_firestore(this.config.database_id);
        this.collection = this.db.collection(this.config.collection_name);
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
            await this.collection.doc(doc_id).create({
                time: message.time,
                message_id: message.message_id,
                sender: message.sender_id,
                text: message.text
            });
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
            await this.collection.doc(doc_id).update({
                text: message.text
            });
        } catch (error) {
            return (((error) instanceof Error) ? Expected.err((error).message) : Expected.err(String(error)));
        }
        return Expected.ok(undefined);
    }

    async get_messages(from: Date, to: Date): Promise<Expected<Message[]>> {
        try {
            const messages = await this.collection
                .where("time", ">=", from)
                .where("time", "<=", to)
                .orderBy("time", "asc")
                .get();
            const result: Message[] = [];

            messages.forEach((doc) => {
                result.push({
                    time: new Date(doc.data().time._seconds * 1000),
                    message_id: doc.data().message_id ?? "",
                    sender_id: doc.data().sender,
                    text: doc.data().text
                })
            });
            return Expected.ok(result);
        } catch (error) {
            return (((error) instanceof Error) ? Expected.err((error).message) : Expected.err(String(error)));
        }
    }
}