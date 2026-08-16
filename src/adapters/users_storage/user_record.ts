import { VersionedPlainItem } from "@src/interfaces/plain_collection.js";

// Flat users-collection document. Nested UserId is assembled only in UserData
// (IPlainCollection does not support nested objects).
// PlainItem.id is system_id.
export type UserRecord = VersionedPlainItem & {
    tg_username?: string;
    name: string;
    surname: string;
    lang: string;
    voice: string;
    roles: string[];
}
