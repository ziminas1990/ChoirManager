import { Expected, Status } from "@src/utils/expected.js";

type CAS<T> = [expected: T, next: T];

type ArrayCAS<T> = {
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

export type PlainPatch<T> = {
    [K in keyof T]?:
        T[K] extends Atomic ? T[K]
        : T[K] extends Array<infer U> ? U[]
        : T[K] extends object ? PlainPatch<T[K]>
        : never;
};

export function apply_plain_patch<T extends object>(current: T, patch: PlainPatch<T>)
: Expected<T> {
    try {
        const next = structuredClone(current);
        const applied = apply_plain_object(next, patch, "");
        if (!applied.ok) {
            return applied.cast_error();
        }
        return Expected.ok(next);
    } catch (error) {
        return Expected.exception("got exception", error);
    }
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

function apply_plain_object<T extends object>(current: T, patch: PlainPatch<T>, path: string)
: Status
{
    for (const key of Object.keys(patch) as Array<keyof T>) {
        const field_patch = patch[key];
        if (field_patch === undefined) {
            continue;
        }

        const field_path = path === "" ? String(key) : `${path}.${String(key)}`;
        const applied = apply_plain_field(current, key, field_patch, field_path);
        if (!applied.ok) {
            return applied;
        }
    }
    return Expected.ok(undefined);
}

function apply_plain_field<T extends object, K extends keyof T>(
    current: T,
    key: K,
    patch: NonNullable<PlainPatch<T>[K]>,
    path: string
): Status {
    const value = current[key];
    if (Array.isArray(value) || Array.isArray(patch)) {
        current[key] = patch as T[K];
        return Expected.ok(undefined);
    }
    if (value !== null && typeof value === "object" && !is_atomic(value)) {
        if (patch === null || typeof patch !== "object") {
            return Expected.err(`${path}: expected a nested object patch`);
        }
        return apply_plain_object(value, patch as PlainPatch<typeof value>, path);
    }
    current[key] = patch as T[K];
    return Expected.ok(undefined);
}

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
