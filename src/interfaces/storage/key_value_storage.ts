import { Expected, Status } from "@src/utils/expected.js";

// Pure string persistence: serialization belongs to callers.
export interface IKeyValueStorage {
    // An absent key is a successful read with no document.
    get(key: string): Promise<Expected<string | undefined>>;

    // Replace the complete value, creating the document if absent.
    update(key: string, document: string): Promise<Status>;

    // Deleting an absent key succeeds.
    delete(key: string): Promise<Status>;
}
