import { Expected, Status } from "@src/utils/expected.js";

type Atomic = string | number | boolean | Date | undefined | null;

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

function is_atomic(value: unknown): boolean {
    return value === null
        || value === undefined
        || typeof value === "string"
        || typeof value === "number"
        || typeof value === "boolean"
        || value instanceof Date;
}
