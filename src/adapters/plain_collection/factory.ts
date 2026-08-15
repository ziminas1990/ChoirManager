import { FirestoreDataConverter } from "@google-cloud/firestore";

import { CacheAsideCollection } from "@src/components/collections/cache_aside_collection.js";
import { IPlainCollection, VersionedPlainItem } from "@src/interfaces/plain_collection.js";
import { Journal } from "@src/journal.js";
import { Expected, Status } from "@src/utils/expected.js";
import { FirestorePlainCollection } from "./firestore_plain_collection.js";

export type PlainCollectionConfig = {
    type: "google_firestore";
    database_id: string;
    collection_name: string;
    cache_size?: number;
}

const DEFAULT_CACHE_SIZE = 500;

export class PlainCollectionFactory {

    static verify(config: PlainCollectionConfig): Status {
        if (!config.type) {
            return Expected.err("'type' MUST be specified");
        }
        const available_types = ["google_firestore"];
        if (!available_types.includes(config.type)) {
            return Expected.err(`'type' MUST be: ${available_types.join(", ")}`);
        }
        switch (config.type) {
            case "google_firestore": {
                if (!config.database_id) {
                    return Expected.err("'database_id' MUST be specified");
                }
                if (!config.collection_name) {
                    return Expected.err("'collection_name' MUST be specified");
                }
                if (config.cache_size != undefined && config.cache_size <= 0) {
                    return Expected.err("'cache_size' MUST be greater than 0");
                }
                return Expected.ok(undefined);
            }
        }
    }

    static create<T extends VersionedPlainItem>(
        config: PlainCollectionConfig,
        data_converter: FirestoreDataConverter<T>,
        parent_journal: Journal,
    ): Expected<IPlainCollection<T>>
    {
        const verified = PlainCollectionFactory.verify(config);
        if (!verified.ok) {
            return verified.cast_error();
        }

        switch (config.type) {
            case "google_firestore": {
                const firestore = new FirestorePlainCollection<T>(
                    config.database_id,
                    config.collection_name,
                    data_converter,
                    parent_journal,
                );
                const cache_size = config.cache_size ?? DEFAULT_CACHE_SIZE;
                return Expected.ok(new CacheAsideCollection(firestore, cache_size));
            }
        }
    }
}
