import { FirestoreDataConverter } from "@google-cloud/firestore";

import { CacheAsideCollection } from "@src/components/collections/cache_aside_collection.js";
import { IPlainCollection, VersionedPlainItem } from "@src/interfaces/plain_collection.js";
import { Journal } from "@src/journal.js";
import { Expected, Status } from "@src/utils/expected.js";
import { FirestorePlainCollection } from "./firestore_plain_collection.js";

export type FirestorePlainCollectionConfig = {
    type: "google_firestore";
    database_id: string;
    collection_name: string;
}

export type CacheAsideCollectionConfig = {
    type: "cache_aside_collection";
    cache_size: number;
    underlying: PlainCollectionConfig;
}

export type PlainCollectionConfig =
    | FirestorePlainCollectionConfig
    | CacheAsideCollectionConfig;

const AVAILABLE_TYPES = ["google_firestore", "cache_aside_collection"];

export class PlainCollectionFactory {

    static verify(config: PlainCollectionConfig): Status {
        if (!config.type) {
            return Expected.err("'type' MUST be specified");
        }
        if (!AVAILABLE_TYPES.includes(config.type)) {
            return Expected.err(`'type' MUST be: ${AVAILABLE_TYPES.join(", ")}`);
        }
        switch (config.type) {
            case "google_firestore": {
                if (!config.database_id) {
                    return Expected.err("'database_id' MUST be specified");
                }
                if (!config.collection_name) {
                    return Expected.err("'collection_name' MUST be specified");
                }
                return Expected.ok(undefined);
            }
            case "cache_aside_collection": {
                if (!config.cache_size || config.cache_size <= 0) {
                    return Expected.err("'cache_size' MUST be greater than 0");
                }
                if (!config.underlying) {
                    return Expected.err("'underlying' MUST be specified");
                }
                const underlying_status = PlainCollectionFactory.verify(config.underlying);
                if (!underlying_status.ok) {
                    return underlying_status.wrap_error("'underlying' misconfiguration");
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
                return Expected.ok(firestore);
            }
            case "cache_aside_collection": {
                const underlying = PlainCollectionFactory.create(
                    config.underlying,
                    data_converter,
                    parent_journal,
                );
                if (!underlying.ok) {
                    return underlying;
                }
                return Expected.ok(new CacheAsideCollection(underlying.value, config.cache_size));
            }
        }
    }
}
