import { Expected, Status } from "@src/utils/expected.js";

type CAS<T> = [expected: T, next: T];

export type ArrayCAS<T> = {
    // When provided, compare the entire array before applying any changes.
    expected?: T[];
    remove?: { index: number, value: T }[];
    append?: T[];
    replace?: { index: number, patch: CAS<T> }[];
};

type Atomic = string | number | boolean | Date | undefined | null;
type ArrayElement<T> = T extends readonly (infer E)[] ? E : never;

export type CasPatch<T> = {
    [K in keyof T]?:
        T[K] extends Atomic ? CAS<T[K]>
        : T[K] extends Array<infer U> ? ArrayCAS<U>
        : T[K] extends object ? CasPatch<T[K]>
        : never;
};

// Build a CAS array patch that turns `current` into the same *set* of atomics as
// `desired`. Surviving values keep their slots; removed slots are reused via
// replace when possible. Final order may differ from `desired`.
export function build_array_cas_patch<T extends Atomic>(
    current: readonly T[],
    desired: readonly T[],
): ArrayCAS<T> {
    const current_set = new Set(current);
    const desired_set = new Set(desired);

    // A': values to add, in desired order (unique).
    const to_add: T[] = [];
    const seen_add = new Set<T>();
    for (const value of desired) {
        if (!current_set.has(value) && !seen_add.has(value)) {
            to_add.push(value);
            seen_add.add(value);
        }
    }

    // D': values to remove, in current order (unique, with original indices).
    const to_remove: { index: number, value: T }[] = [];
    const seen_remove = new Set<T>();
    for (let index = 0; index < current.length; index++) {
        const value = current[index];
        if (!desired_set.has(value) && !seen_remove.has(value)) {
            to_remove.push({ index, value });
            seen_remove.add(value);
        }
    }

    const paired = Math.min(to_add.length, to_remove.length);
    const replace: { index: number, patch: CAS<T> }[] = [];
    for (let i = 0; i < paired; i++) {
        replace.push({
            index: to_remove[i].index,
            patch: [to_remove[i].value, to_add[i]],
        });
    }

    const patch: ArrayCAS<T> = {};
    if (replace.length > 0) {
        patch.replace = replace;
    }
    if (to_add.length > paired) {
        patch.append = to_add.slice(paired);
    }
    if (to_remove.length > paired) {
        patch.remove = to_remove.slice(paired);
    }
    return patch;
}

export function apply_cas_patch<T extends object>(current: T, patch: CasPatch<T>)
: Expected<T> {
    try {
        const next = structuredClone(current);
        const applied = apply_object(next, patch, "");
        if (!applied.ok) {
            return applied.cast_error();
        }
        return Expected.ok(next);
    } catch (error) {
        return Expected.exception("got exception", error);
    }
}

type Test = {
    name: string | null;
    age: number | undefined;
    is_admin: boolean;
    roles: (string | null)[];
    id: {
        internal: string;
        external?: string;
    };
};

type TestPatch = CasPatch<Test>;

const patch: TestPatch = {
    name: ["John", "Jane"],
    age: [20, 21],
    is_admin: [true, false],
    roles: {
        append: ["admin", "user"],
        remove: [{ index: 0, value: "user" }],
        replace: [{ index: 1, patch: ["admin", "user"] }],
    },
};

void patch;

function apply_object<T extends object>(current: T, patch: CasPatch<T>, path: string)
: Status
{
    for (const key of Object.keys(patch) as Array<keyof T>) {
        const field_patch = patch[key];
        if (field_patch === undefined) {
            continue;
        }

        const field_path = path === "" ? String(key) : `${path}.${String(key)}`;
        const applied = apply_field(current, key, field_patch, field_path);
        if (!applied.ok) {
            return applied;
        }
    }
    return Expected.ok(undefined);
}

function apply_field<T extends object, K extends keyof T>(
    current: T,
    key: K,
    patch: NonNullable<CasPatch<T>[K]>,
    path: string
): Status {
    const value = current[key];
    if (Array.isArray(value)) {
        return apply_array(current, key, patch as ArrayCAS<ArrayElement<T[K]>>, path);
    }
    if (is_atomic(value)) {
        return apply_atomic(current, key, patch as CAS<T[K]>, path);
    }
    if (value !== null && typeof value === "object") {
        return apply_object(value, patch as CasPatch<typeof value>, path);
    }
    return Expected.err(`${path}: unsupported value`);
}

function apply_atomic<T, K extends keyof T>(
    current: T,
    key: K,
    patch: CAS<T[K]>,
    path: string
): Status {
    const [expected, next] = patch;
    if (!atomic_equal(current[key], expected)) {
        return Expected.err(
            `${path}: conflict, expected ${describe(expected)}, got ${describe(current[key])}`
        );
    }
    current[key] = next;
    return Expected.ok(undefined);
}

function apply_array<T, K extends keyof T>(
    current: T,
    key: K,
    patch: ArrayCAS<ArrayElement<T[K]>>,
    path: string
): Status {
    const current_array = current[key] as ArrayElement<T[K]>[];

    if (patch.expected !== undefined && !equal(current_array, patch.expected)) {
        return Expected.err(
            `${path}: conflict, expected ${describe(patch.expected)}, got ${describe(current_array)}`
        );
    }

    const claimed = new Map<number, string>();
    const claim = (index: number, op: string): Status => {
        if (!Number.isInteger(index) || index < 0) {
            return Expected.err(`${path}: ${op} index ${index} is invalid`);
        }
        if (index >= current_array.length) {
            return Expected.err(
                `${path}: ${op} index ${index} is out of range (length ${current_array.length})`
            );
        }
        const previous = claimed.get(index);
        if (previous !== undefined) {
            return Expected.err(`${path}: index ${index} is used by both ${previous} and ${op}`);
        }
        claimed.set(index, op);
        return Expected.ok(undefined);
    };

    for (const item of patch.replace ?? []) {
        const claimed_index = claim(item.index, "replace");
        if (!claimed_index.ok) {
            return claimed_index;
        }
        const [expected] = item.patch;
        if (!equal(current_array[item.index], expected)) {
            return Expected.err(
                `${path}[${item.index}]: conflict, expected ${describe(expected)}, got ${describe(current_array[item.index])}`
            );
        }
    }

    for (const item of patch.remove ?? []) {
        const claimed_index = claim(item.index, "remove");
        if (!claimed_index.ok) {
            return claimed_index;
        }
        if (!equal(current_array[item.index], item.value)) {
            return Expected.err(
                `${path}[${item.index}]: conflict, expected ${describe(item.value)}, got ${describe(current_array[item.index])}`
            );
        }
    }

    for (const item of patch.replace ?? []) {
        current_array[item.index] = item.patch[1];
    }

    const remove_indices = [...(patch.remove ?? [])]
        .map((item) => item.index)
        .sort((a, b) => b - a);
    for (const index of remove_indices) {
        current_array.splice(index, 1);
    }

    if (patch.append !== undefined) {
        current_array.push(...patch.append);
    }
    return Expected.ok(undefined);
}

function is_atomic(value: unknown): boolean {
    return value === null
        || value === undefined
        || typeof value === "string"
        || typeof value === "number"
        || typeof value === "boolean"
        || value instanceof Date;
}

function atomic_equal(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) {
        return true;
    }
    if (left instanceof Date && right instanceof Date) {
        return left.getTime() === right.getTime();
    }
    return false;
}

function equal(left: unknown, right: unknown): boolean {
    if (atomic_equal(left, right)) {
        return true;
    }
    if (Array.isArray(left) && Array.isArray(right)) {
        return left.length === right.length
            && left.every((item, index) => equal(item, right[index]));
    }
    if (
        left !== null && right !== null
        && typeof left === "object" && typeof right === "object"
        && !Array.isArray(left) && !Array.isArray(right)
        && !(left instanceof Date) && !(right instanceof Date)
    ) {
        const left_keys = Object.keys(left);
        const right_keys = Object.keys(right);
        if (left_keys.length !== right_keys.length) {
            return false;
        }
        return left_keys.every((key) => (
            key in right
            && equal(
                (left as Record<string, unknown>)[key],
                (right as Record<string, unknown>)[key]
            )
        ));
    }
    return false;
}

function describe(value: unknown): string {
    if (value === undefined) {
        return "undefined";
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}
