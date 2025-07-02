import { Status, StatusWith } from "@src/status.js";
import { IMessagesBacklog, Message } from "@src/interfaces/messages_backlog.js";
import { CollectionReference, Firestore } from "@google-cloud/firestore";
import { GoogleAuth } from "@src/api/google_auth";

export type Config = {
    database_id: string,
    collection_name: string,
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
        return Status.ok();
    }

    async add_message(message: Message): Promise<Status> {
        try {
            if (this.read_only) {
                return Status.fail("Read-only mode");
            }
            await this.collection.add({
                time: message.time,
                    sender: message.sender,
                    text: message.text
            });
        } catch (error) {
            return Status.exception(error);
        }
        return Status.ok();
    }

    async get_messages(from: Date, to: Date): Promise<StatusWith<Message[]>> {
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
                    sender: doc.data().sender,
                    text: doc.data().text
                })
            });
            return Status.ok().with(result);
        } catch (error) {
            return Status.exception(error);
        }
    }
}