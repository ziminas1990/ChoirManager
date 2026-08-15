import {
    FirestoreDataConverter,
    Query,
    Transaction,
} from "@google-cloud/firestore";

import { GoogleAuth } from "@src/api/google_auth.js";
import {
    Hooks,
    IPlainCollection,
    PartialWithId,
    VersionedPlainItem,
} from "@src/interfaces/plain_collection.js";
import { Journal } from "@src/journal.js";
import { Metrics } from "@src/monitoring/metrics.js";
import { Expected, Status } from "@src/utils/expected.js";
import { apply_patch, get_changes_log } from "@src/utils/plain_object.js";
import { TokenBucket } from "@src/utils/token_bucket.js";


type GetOrCreateTransactionResult<T> = {
    item: T;
    created: boolean;
}

type UpdateTransactionResult<T> = {
    item: T;
    update_log: string;
}

type GetOrCreateTransaction<T> = (transaction: Transaction) => Promise<Expected<GetOrCreateTransactionResult<T>>>;
type UpdateTransaction<T> = (transaction: Transaction) => Promise<Expected<UpdateTransactionResult<T>>>;

// Direct Firestore access without caching. Wrap with CacheAsideCollection
// when an in-process cache is needed.
export class FirestorePlainCollection<T extends VersionedPlainItem>
implements IPlainCollection<T>
{
    private readonly journal: Journal;
    private readonly api_tokens: TokenBucket;

    constructor(
        private readonly database_id: string,
        private readonly collection_name: string,
        private readonly data_converter: FirestoreDataConverter<T>,
        parent_journal: Journal
    ) {
        this.journal = parent_journal.child(`firestore.${collection_name}`);
        this.api_tokens = new TokenBucket({
            max_tokens: 20,
            refill_rate: 5,
        });
    }

    async proceed(_now: Date): Promise<void> {
        // Nothing to do here, objects don't need to be proceeded
    }

    async create(item: T): Promise<Expected<T>> {
        Metrics.inc("firestore_plain_collection_call", {
            collection: this.collection_name,
            action: "create"
        });

        try {
            const firestore = GoogleAuth.get_firestore(this.database_id);
            const collection = this.get_collection();
            const doc_ref = collection.doc(item.id);

            const create_transaction = async (transaction: Transaction) => {
                const doc = await transaction.get(doc_ref);
                if (doc.exists) {
                    return Expected.err(`Item with id '${item.id}' already exists`);
                }

                const to_store = { ...item, revision: 1 };
                transaction.set(doc_ref, to_store);
                return Expected.ok(to_store);
            };

            await this.api_tokens.wait_tokens(1);
            const result = await firestore.runTransaction(create_transaction);
            if (!result.ok) {
                return result;
            }

            this.journal.log().info({ item: result.value }, `Created new item`);
            return Expected.ok(result.value);
        } catch (error) {
            return Expected.exception("Firestore exception during create", error);
        }
    }

    async get_or_create(id: string, item: Omit<T, "id">): Promise<Expected<T>> {
        Metrics.inc("firestore_plain_collection_call", {
            collection: this.collection_name,
            action: "get_or_create"
        });

        try {
            const firestore = GoogleAuth.get_firestore(this.database_id);
            const collection = this.get_collection();
            const doc_ref = collection.doc(id);

            const get_or_create_transaction: GetOrCreateTransaction<T> = async (transaction) => {
                const doc = await transaction.get(doc_ref);

                if (doc.exists) {
                    return Expected.ok({ item: doc.data() as T, created: false });
                }

                const full_item = { ...item, id, revision: 1 } as T;
                transaction.set(doc_ref, full_item);
                return Expected.ok({ item: full_item, created: true });
            };

            await this.api_tokens.wait_tokens(1);
            const result = await firestore.runTransaction(get_or_create_transaction);
            if (!result.ok) {
                return result.cast_error();
            }

            const fetched_item = result.value.item;
            if (result.value.created) {
                this.journal.log().info({ item: fetched_item }, `Created new item`);
            }
            return Expected.ok(fetched_item);
        } catch (error) {
            return Expected.exception("Firestore exception during get_or_create", error);
        }
    }

    async get_one(id: string): Promise<Expected<T>> {
        Metrics.inc("firestore_plain_collection_call", {
            collection: this.collection_name,
            action: "get_one"
        });

        try {
            const collection = this.get_collection();
            await this.api_tokens.wait_tokens(1);
            const doc = await collection.doc(id).get();

            if (!doc.exists) {
                return Expected.err(`Item with id '${id}' not found`);
            }

            const data = doc.data() as T;
            return Expected.ok(data);
        } catch (error) {
            return Expected.exception("Firestore exception during get_one", error);
        }
    }

    async get_many(ids: string[]): Promise<Expected<T[]>> {
        if (ids.length === 0) {
            return Expected.ok([]);
        }

        Metrics.inc("firestore_plain_collection_call", {
            collection: this.collection_name,
            action: "get_many"
        });

        try {
            const collection = this.get_collection();
            const results: T[] = [];

            // Firestore limits 'in' queries to 30 items, so we batch the requests
            const batch_size = 30;
            for (let i = 0; i < ids.length; i += batch_size) {
                const batch_ids = ids.slice(i, i + batch_size);
                await this.api_tokens.wait_tokens(1);
                const docs = await collection
                    .where("id", "in", batch_ids)
                    .get();

                for (const doc of docs.docs) {
                    results.push(doc.data() as T);
                }
            }

            return Expected.ok(results);
        } catch (error) {
            return Expected.exception("Firestore exception during get_many", error);
        }
    }

    supports(feature: "get_all" | "hooks"): boolean {
        switch (feature) {
            case "get_all":
                return true;
            case "hooks":
                return false;
        }
    }

    async get_all(): Promise<Expected<T[]>> {
        Metrics.inc("firestore_plain_collection_call", {
            collection: this.collection_name,
            action: "get_all"
        });

        try {
            const collection = this.get_collection();
            await this.api_tokens.wait_tokens(1);
            const docs = await collection.get();
            const items: T[] = [];

            for (const doc of docs.docs) {
                items.push(doc.data() as T);
            }

            return Expected.ok(items);
        } catch (error) {
            return Expected.exception("Firestore exception during get_all", error);
        }
    }

    async find_all(pattern: Partial<T>): Promise<Expected<T[]>> {
        Metrics.inc("firestore_plain_collection_call", {
            collection: this.collection_name,
            action: "find_all"
        });

        try {
            const collection = this.get_collection();
            let query: Query = collection;

            // Build query from pattern - only supports equality checks on
            // plain fields
            for (const [key, value] of Object.entries(pattern)) {
                if (value !== undefined) {
                    query = query.where(key, "==", value);
                }
            }

            await this.api_tokens.wait_tokens(1);
            const docs = await query.get();
            const items: T[] = [];

            for (const doc of docs.docs) {
                items.push(doc.data() as T);
            }

            return Expected.ok(items);
        } catch (error) {
            return Expected.exception("Firestore exception during find_all", error);
        }
    }

    // If `patch` doesn't specify revision, it means that patch should be
    // applied anyway, whatever is the revision of the item in the database.
    // If `patch` specifies revision, it means that patch should be applied only
    // if the revision of the item in the database is the same as the revision
    // in the patch. If the revision is different, the patch will be rejected.
    async update(patch: PartialWithId<T>): Promise<Expected<T>> {
        if (!patch.id) {
            return Expected.err("Patch must have an 'id' field");
        }

        Metrics.inc("firestore_plain_collection_call", {
            collection: this.collection_name,
            action: "update"
        });

        try {
            const firestore = GoogleAuth.get_firestore(this.database_id);
            const collection = this.get_collection();
            const doc_ref = collection.doc(patch.id);

            const update_transaction: UpdateTransaction<T> = async (transaction) => {
                const doc = await transaction.get(doc_ref);

                if (!doc.exists || doc.data() === undefined) {
                    return Expected.err(`Item with id '${patch.id}' not found`);
                }
                const recent_revision = doc.data()!.revision;
                if (patch.revision !== undefined && patch.revision !== recent_revision)
                {
                    return Expected.err(
                        `Revision mismatch: expected ${patch.revision}, got ${recent_revision}`);
                }

                const item = doc.data() as T;
                const updated_item = apply_patch({ ...item }, patch);
                updated_item.revision = recent_revision + 1;
                const update_log = get_changes_log(item, updated_item);

                transaction.set(doc_ref, updated_item);
                return Expected.ok({ item: updated_item, update_log: update_log.join(", ") });
            };

            await this.api_tokens.wait_tokens(1);
            const result = await firestore.runTransaction(update_transaction);
            if (!result.ok) {
                return result.cast_error();
            }

            const { item, update_log } = result.value;
            if (update_log) {
                this.journal.log().info(`Updated item ${patch.id}: ${update_log}`);
            }

            return Expected.ok(item);
        } catch (error) {
            return Expected.exception("Firestore exception during update", error);
        }
    }

    async delete(ids: string[]): Promise<Status> {
        if (ids.length === 0) {
            return Expected.ok(undefined);
        }

        Metrics.inc("firestore_plain_collection_call", {
            collection: this.collection_name,
            action: "delete"
        });

        try {
            const firestore = GoogleAuth.get_firestore(this.database_id);
            const collection = this.get_collection();

            // Firestore batch limit is 500 operations
            const batch_size = 500;
            for (let i = 0; i < ids.length; i += batch_size) {
                const batch_ids = ids.slice(i, i + batch_size);
                const batch = firestore.batch();

                for (const id of batch_ids) {
                    batch.delete(collection.doc(id));
                }

                await this.api_tokens.wait_tokens(1);
                await batch.commit();
            }

            this.journal.log().info({ ids }, `Deleted items`);
            return Expected.ok(undefined);
        } catch (error) {
            return Expected.exception("Firestore exception during delete", error);
        }
    }

    add_hook(_hook: Hooks<T>): void {
        throw new Error("Hooks are not supported by FirestorePlainCollection");
    }

    remove_hook(_name: string): void {
        throw new Error("Hooks are not supported by FirestorePlainCollection");
    }

    private get_collection() {
        const firestore = GoogleAuth.get_firestore(this.database_id);
        return firestore.collection(this.collection_name)
                        .withConverter(this.data_converter);
    }
}
