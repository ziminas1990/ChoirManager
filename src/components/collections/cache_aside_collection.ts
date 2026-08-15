import { Expected, Status } from "@src/utils/expected.js";
import { Hooks, IPlainCollection, PartialWithId, PlainItem } from "@src/interfaces/plain_collection.js";


type CachedItem<T> = {
    item: T;
    last_access: Date;
}

export class CacheAsideCollection<T extends PlainItem>
implements IPlainCollection<T>
{

    private cache: Map<string, CachedItem<T>> = new Map();

    constructor(
        private underlying: IPlainCollection<T>,
        private cache_size: number
    ) {
    }

    async proceed(now: Date): Promise<void> {
        await this.underlying.proceed(now);
    }

    async create(item: T): Promise<Expected<T>> {
        const result = await this.underlying.create(item);
        if (result.ok) {
            this.update_cache({ ...result.value });
        }
        return result;
    }

    async get_or_create(id: string, item: Omit<T, "id">): Promise<Expected<T>> {
        const cached_entry = this.cache.get(id);
        if (cached_entry) {
            this.update_access_time(id);
            return Expected.ok({ ...cached_entry.item });
        }

        const result = await this.underlying.get_or_create(id, item);
        if (result.ok) {
            this.update_cache({ ...result.value });
        }
        return result;
    }

    async get_one(id: string): Promise<Expected<T>> {
        const cached_entry = this.cache.get(id);
        if (cached_entry) {
            this.update_access_time(id);
            return Expected.ok({ ...cached_entry.item });
        }

        const result = await this.underlying.get_one(id);
        if (result.ok) {
            this.update_cache({ ...result.value });
        }
        return result;
    }

    async get_many(ids: string[]): Promise<Expected<T[]>> {
        const items: T[] = [];
        const cache_hit_ids: string[] = [];
        const cache_miss_ids: string[] = [];

        ids.forEach(id => {
            if (this.cache.has(id)) {
                cache_hit_ids.push(id);
            } else {
                cache_miss_ids.push(id);
            }
        });

        for (const id of cache_hit_ids) {
            const cached_entry = this.cache.get(id);
            if (cached_entry) {
                this.update_access_time(id);
                items.push({ ...cached_entry.item });
            }
        }

        if (cache_miss_ids.length > 0) {
            const result = await this.underlying.get_many(cache_miss_ids);
            if (result.ok) {
                for (const item of result.value) {
                    this.update_cache({ ...item });
                    items.push({ ...item });
                }
            } else {
                return result;
            }
        }

        return Expected.ok(items);
    }

    supports(feature: "get_all" | "hooks"): boolean {
        return this.underlying.supports(feature);
    }

    async get_all(): Promise<Expected<T[]>> {
        const result = await this.underlying.get_all();
        if (result.ok) {
            for (const item of result.value) {
                this.update_cache({ ...item });
            }
        }
        return result;
    }

    async find_all(pattern: Partial<T>): Promise<Expected<T[]>> {
        const result = await this.underlying.find_all(pattern);
        if (result.ok) {
            for (const item of result.value) {
                this.update_cache({ ...item });
            }
        }
        return result;
    }

    async update(patch: PartialWithId<T>): Promise<Expected<T>> {
        const result = await this.underlying.update(patch);
        if (result.ok) {
            this.update_cache({ ...result.value });
        }
        return result;
    }

    async delete(ids: string[]): Promise<Status> {
        const result = await this.underlying.delete(ids);
        if (result.ok) {
            for (const id of ids) {
                this.cache.delete(id);
            }
        }
        return result;
    }

    private update_cache(item: T): void {
        const now = new Date();
        this.cache.set(item.id, {
            item: item,
            last_access: now
        });
        this.enforce_cache_size();
    }

    private update_access_time(id: string): void {
        const cached_entry = this.cache.get(id);
        if (cached_entry) {
            cached_entry.last_access = new Date();
        }
    }

    private enforce_cache_size(): void {
        if (this.cache.size > this.cache_size) {
            const items_to_remove = this.cache.size - this.cache_size;

            const entries: Array<{ id: string; last_access: Date }> = [];
            for (const [id, cached_entry] of this.cache.entries()) {
                entries.push({ id, last_access: cached_entry.last_access });
            }

            entries.sort((a, b) =>
                a.last_access.getTime() - b.last_access.getTime()
            );

            for (let i = 0; i < items_to_remove; i++) {
                this.cache.delete(entries[i].id);
            }
        }
    }

    add_hook(hook: Hooks<T>): void {
        this.underlying.add_hook(hook);
    }
    remove_hook(name: string): void {
        this.underlying.remove_hook(name);
    }
}
