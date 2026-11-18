import { Expected, Status } from "@src/utils/expected.js";

export enum KeyValueStorageError {
    AlreadyExists = 1,
}

// Pure string persistence: serialization belongs to callers.
export interface IKeyValueStorage {
    // Create a new document; return AlreadyExists if the key already exists.
    create(key: string, document: string): Promise<Status>;

    // An absent key is a successful read with no document.
    get(key: string): Promise<Expected<string | undefined>>;

    // Replace the complete value, creating the document if absent.
    update(key: string, document: string): Promise<Status>;

    // Deleting an absent key succeeds.
    delete(key: string): Promise<Status>;
}
