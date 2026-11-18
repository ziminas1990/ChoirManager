import { CollectionReference } from "@google-cloud/firestore";

import { GoogleAuth } from "@src/api/google_auth.js";
import { IKeyValueStorage, KeyValueStorageError } from "@src/interfaces/storage/key_value_storage.js";
import { Expected, Status } from "@src/utils/expected.js";

export type Config = {
    database_id: string;
    collection_name: string;
};

export class GoogleFirestoreKeyValueStorage implements IKeyValueStorage {
    private readonly collection: CollectionReference;

    constructor(config: Config) {
        const database = GoogleAuth.get_firestore(config.database_id);
        this.collection = database.collection(config.collection_name);
    }

    async create(key: string, document: string): Promise<Status> {
        try {
            await this.collection.doc(key).create({ value: document });
            return Expected.ok(undefined);
        } catch (error) {
            const status: Status = Expected.exception(`Failed to create document '${key}'`, error);
            if (Helpers.is_already_exists(error)) {
                return status.set_error_code(KeyValueStorageError.AlreadyExists);
            }
            return status;
        }
    }

    async get(key: string): Promise<Expected<string | undefined>> {
        try {
            const document = await this.collection.doc(key).get();
            if (!document.exists) {
                return Expected.ok(undefined);
            }
            const value: unknown = document.data()?.value;
            if (typeof value !== "string") {
                return Expected.err(`Document '${key}' must contain a string value`);
            }
            return Expected.ok(value);
        } catch (error) {
            return Expected.exception(`Failed to read document '${key}'`, error);
        }
    }

    async update(key: string, document: string): Promise<Status> {
        try {
            await this.collection.doc(key).set({ value: document }, { merge: false });
            return Expected.ok(undefined);
        } catch (error) {
            return Expected.exception(`Failed to write document '${key}'`, error);
        }
    }

    async delete(key: string): Promise<Status> {
        try {
            await this.collection.doc(key).delete();
            return Expected.ok(undefined);
        } catch (error) {
            return Expected.exception(`Failed to delete document '${key}'`, error);
        }
    }
}

class Helpers {
    // Firestore reports a duplicate document as gRPC status ALREADY_EXISTS (code 6).
    static is_already_exists(error: unknown): boolean {
        return typeof error === "object"
            && error !== null
            && "code" in error
            && error.code === 6;
    }
}
