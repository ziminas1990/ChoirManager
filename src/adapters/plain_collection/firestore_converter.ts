import {
    DocumentData,
    FirestoreDataConverter,
    QueryDocumentSnapshot,
    Timestamp,
} from "@google-cloud/firestore";
import { Status } from "@src/utils/expected.js";


export class FirestoreValidatingConverter<T> implements FirestoreDataConverter<T>
{
    constructor(
        private readonly validator: (data: T) => Status,
        private readonly to_db: (data: T) => DocumentData,
        private readonly from_db: (data: DocumentData, doc_id: string) => T
    ) {}

    toFirestore(data: T): DocumentData {
        return { ...this.to_db(data) };
    }

    fromFirestore(snapshot: QueryDocumentSnapshot): T {
        const data = this.from_db(snapshot.data(), snapshot.id);
        const status = this.validator(data);
        if (!status.ok) {
            throw new Error(status.error);
        }
        return data;
    }
}

// Firestore stores dates as Timestamp; convert them to Date recursively.
export function firestore_convert_dates(data: DocumentData): DocumentData {
    for (const [key, value] of Object.entries(data)) {
        if (value instanceof Timestamp) {
            data[key] = value.toDate();
        } else if (Array.isArray(value)) {
            data[key] = value.map((item) =>
                typeof item === "object" && item !== null
                    ? firestore_convert_dates(item as DocumentData)
                    : item
            );
        } else if (typeof value === "object" && value !== null) {
            data[key] = firestore_convert_dates(value as DocumentData);
        }
    }
    return data;
}
