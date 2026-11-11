import assert from "node:assert/strict";

import { IPlainCollection, PlainItem } from "@src/interfaces/plain_collection.js";
import { Expected } from "@src/utils/expected.js";

import { object } from "@tests/helpers/objects.js";

export function read_only_plain_collection<T extends PlainItem>(items: T[] = []): IPlainCollection<T> {
    const records = new Map(items.map(item => [item.id, structuredClone(item)]));
    return {
        async proceed() {},
        async get_one(id) {
            const item = records.get(id);
            return item === undefined
                ? Expected.err(`Item '${id}' not found`)
                : Expected.ok(structuredClone(item));
        },
        async get_many(ids) {
            return Expected.ok(structuredClone([...records.values()]
                .filter(item => ids.includes(item.id))));
        },
        async get_all() {
            return Expected.ok(structuredClone([...records.values()]));
        },
        async find_all(pattern) {
            return Expected.ok(structuredClone([...records.values()]
                .filter(item => Object.entries(pattern).every(([key, value]) => object(item)[key] === value))));
        },
        async create() { assert.fail("Unexpected write to a read-only test collection"); },
        async get_or_create() { assert.fail("Unexpected write to a read-only test collection"); },
        async update() { assert.fail("Unexpected write to a read-only test collection"); },
        async delete() { assert.fail("Unexpected write to a read-only test collection"); },
        add_hook() { assert.fail("Hooks are not supported by this test collection"); },
        remove_hook() { assert.fail("Hooks are not supported by this test collection"); },
        supports(feature) { return feature === "get_all"; },
    };
}
