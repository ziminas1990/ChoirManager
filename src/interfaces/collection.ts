import { IProceedable } from "@src/interfaces/proceedable.js";
import { Expected, Status } from "@src/utils/expected.js";

// Collection of domain objects. Nested fields are allowed.
// Contrast with IPlainCollection, which stores only plain values.
// P is the patch type accepted by update(); it need not be Partial<T>.
export interface ICollection<T, P> extends IProceedable {

    proceed(now: Date): Promise<void>;

    create(item: T): Promise<Expected<T>>;

    // Return a single item by document id. If it does NOT exist, create `item`.
    get_or_create(id: string, item: T): Promise<Expected<T>>;

    get_one(id: string): Promise<Expected<T>>;
    get_many(ids: string[]): Promise<Expected<T[]>>;

    // NOTE: some implementations may NOT support this method.
    get_all(): Promise<Expected<T[]>>;

    // Apply `patch` to the item identified by `id`. Document identity is `id`;
    // it is not taken from the patch.
    update(id: string, patch: P): Promise<Expected<T>>;

    delete(ids: string[]): Promise<Status>;

    supports(feature: "get_all"): boolean;
}
