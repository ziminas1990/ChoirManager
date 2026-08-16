import { ICollection } from "@src/interfaces/collection.js";
import {
    IPlainCollection,
    PartialWithId,
    PlainItem,
} from "@src/interfaces/plain_collection.js";
import { Journal } from "@src/journal.js";
import { Expected, Status } from "@src/utils/expected.js";

// Packs a (possibly nested) domain object into a plain collection item and back.
export class PackedPlainCollection<T, P, U extends PlainItem>
implements ICollection<T, P>
{
    private readonly journal: Journal;

    constructor(
        private readonly underlying: IPlainCollection<U>,
        private readonly pack: (item: T) => U,
        private readonly unpack: (item: U) => Expected<T>,
        private readonly apply: (item: T, patch: P) => T,
        private readonly id_of: (item: T) => string,
        parent_journal: Journal,
    ) {
        this.journal = parent_journal.child("packed_plain_collection");
    }

    async proceed(now: Date): Promise<void> {
        await this.underlying.proceed(now);
    }

    async create(item: T): Promise<Expected<T>> {
        const stored = await this.underlying.create(this.to_plain(item));
        if (!stored.ok) {
            return stored.cast_error();
        }
        return this.unpack_one(stored.value);
    }

    async get_or_create(id: string, item: T): Promise<Expected<T>> {
        const packed = this.to_plain(item);
        packed.id = id;
        const rest = { ...packed };
        delete (rest as { id?: string }).id;
        const stored = await this.underlying.get_or_create(id, rest as Omit<U, "id">);
        if (!stored.ok) {
            return stored.cast_error();
        }
        return this.unpack_one(stored.value);
    }

    async get_one(id: string): Promise<Expected<T>> {
        const stored = await this.underlying.get_one(id);
        if (!stored.ok) {
            return stored.cast_error();
        }
        return this.unpack_one(stored.value);
    }

    async get_many(ids: string[]): Promise<Expected<T[]>> {
        const stored = await this.underlying.get_many(ids);
        if (!stored.ok) {
            return stored.cast_error();
        }
        return this.unpack_all(stored.value);
    }

    async get_all(): Promise<Expected<T[]>> {
        if (!this.underlying.supports("get_all")) {
            return Expected.err("underlying collection does not support get_all");
        }
        const stored = await this.underlying.get_all();
        if (!stored.ok) {
            return stored.cast_error();
        }
        return this.unpack_all(stored.value);
    }

    async update(id: string, patch: P): Promise<Expected<T>> {
        const existing = await this.get_one(id);
        if (!existing.ok) {
            return existing;
        }
        const next = this.apply(existing.value, patch);
        const stored = await this.underlying.update(
            Helpers.as_update_patch(this.to_plain(next)));
        if (!stored.ok) {
            return stored.cast_error();
        }
        return this.unpack_one(stored.value);
    }

    async delete(ids: string[]): Promise<Status> {
        return this.underlying.delete(ids);
    }

    supports(feature: "get_all"): boolean {
        return this.underlying.supports(feature);
    }

    private to_plain(item: T): U {
        const packed = this.pack(item);
        packed.id = this.id_of(item);
        return packed;
    }

    private unpack_one(item: U): Expected<T> {
        const unpacked = this.unpack(item);
        if (!unpacked.ok) {
            return unpacked.wrap_error(`invalid item '${item.id}'`);
        }
        return unpacked;
    }

    private unpack_all(items: U[]): Expected<T[]> {
        const result: T[] = [];
        for (const item of items) {
            const unpacked = this.unpack(item);
            if (!unpacked.ok) {
                this.journal.log().error(`Invalid item '${item.id}': ${unpacked.error}`);
                continue;
            }
            result.push(unpacked.value);
        }
        return Expected.ok(result);
    }
}

class Helpers {
    // Domain objects are not versioned. Never send revision on update so the
    // underlying store applies the patch regardless of stored revision.
    static as_update_patch<U extends PlainItem>(packed: U): PartialWithId<U> {
        const patch = { ...packed } as U & { revision?: number };
        delete patch.revision;
        return patch;
    }
}
