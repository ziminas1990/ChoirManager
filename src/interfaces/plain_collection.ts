import { Expected, Status } from "@src/utils/expected.js";
import { IProceedable } from "./proceedable.js";


export type PlainItem = {
    id: string;
}

// May be used in some implementations of IPlainCollection
export type VersionedPlainItem = PlainItem & {
    revision: number;
}

export type PartialWithId<T> = Partial<T> & {
    id: string;
}

export type Hooks<T extends PlainItem> = {
    name: string;
    added?: (item: T) => void;
    updated?: (old_item: T, new_item: T) => void;
    removed?: (id: string) => void;
}

// Collection of plain objects: primitives, Dates, and arrays of those.
// Nested objects are not supported.
export interface IPlainCollection<T extends PlainItem> extends IProceedable {

    // Some implementations MAY need to be constantly proceeded to keep
    // the collection up to date.
    proceed(now: Date): Promise<void>;

    // Create a new collection item. If another object with the same id already
    // exists, return an error.
    create(item: T): Promise<Expected<T>>;

    // Return a single collection item by its id. If item does NOT exist,
    // create a new item and return it.
    get_or_create(id: string, item: Omit<T, "id">): Promise<Expected<T>>;

    // Return a single or multiple collection items by their ids.
    // NOTE: a copy of the item is returned. Modifying the item will NOT affect
    // the collection. To modify the item, use the update() method.
    get_one(id: string): Promise<Expected<T>>;
    get_many(ids: string[]): Promise<Expected<T[]>>;

    // NOTE: some implementation may NOT support this method.
    get_all(): Promise<Expected<T[]>>;

    // Find all collection items, that match the specified `pattern`.
    find_all(pattern: Partial<T>): Promise<Expected<T[]>>;

    // Update a collection item by applying the specified `patch`. Patch MUST
    // have an id, that matches the id of the item to update.
    update(patch: PartialWithId<T>): Promise<Expected<T>>;

    // Delete collection items by their ids.
    delete(ids: string[]): Promise<Status>;

    add_hook(hook: Hooks<T>): void;
    remove_hook(name: string): void;

    // Return if feature for the collection is supported.
    supports(feature: "get_all" | "hooks"): boolean;
}

export type IVersionedPlainCollection<T extends VersionedPlainItem> = IPlainCollection<T>;

