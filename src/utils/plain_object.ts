import { shorten } from "@src/utils.js";

function is_plain_value(value: unknown): boolean {
    const type = typeof value;
    if (type === "number" || type === "string" || type === "boolean") {
        return true;
    }
    if (value instanceof Date) {
        return true;
    }
    return false;
}

// Runtime check - returns true if object fields are only primitives, Dates,
// or arrays of primitives/Dates.
export function is_plain_object<T>(value: T): boolean {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    for (const field_value of Object.values(value)) {
        if (is_plain_value(field_value)) {
            continue;
        }
        if (Array.isArray(field_value) && field_value.every(is_plain_value)) {
            continue;
        }
        return false;
    }
    return true;
}

function is_equal<T>(left: T, right: T): boolean {
    if (left === right) {
        return true;
    }
    if (left == null || right == null) {
        return false;
    }
    const left_type = typeof left;
    const right_type = typeof right;
    if (left_type !== right_type) {
        return false;
    }
    if (left_type === "number" || left_type === "boolean" || left_type === "string") {
        return left === right;
    }
    if (left instanceof Date && right instanceof Date) {
        return left.getTime() === right.getTime();
    }
    if (Array.isArray(left) && Array.isArray(right)) {
        return left.length === right.length
            && left.every((value, index) => is_equal(value, right[index]));
    }
    throw new Error(`Plain object must contain only number, string, boolean, or Date fields (or arrays of them)`);
}

// This function is used to apply the specified `patch` to the specified
// `instance` and return result as a new object.
export function apply_patch<T extends object>(instance: T, patch: Partial<T>): T {
    const result = { ...instance };
    for (const [key, value] of Object.entries(patch)) {
        const current_value = result[key as keyof T];
        if (!is_equal(current_value, value)) {
            result[key as keyof T] = value as T[keyof T];
        }
    }
    return result;
}

export function get_patch<T extends object>(
    current: T, new_value: T, ignored_fields: (keyof T)[] = [])
: Partial<T> {
    const patch: Partial<T> = {};
    for (const key of Object.keys(new_value) as (keyof T)[]) {
        if (ignored_fields.includes(key)) {
            continue;
        }
        const current_val = current[key];
        const new_val = new_value[key];
        if (!is_equal(current_val, new_val)) {
            patch[key] = new_val;
        }
    }
    return patch;
}

export function get_changes_log<T extends object>(current: T, updated: T): string[] {
    const changes: string[] = [];
    const current_keys = new Set(Object.keys(current));
    const updated_keys = new Set(Object.keys(updated));

    // Find removed fields (in current but not in updated)
    for (const key of current_keys) {
        if (!updated_keys.has(key)) {
            const value = current[key as keyof T];
            changes.push(`${key} = ${format_value(value)} -> undefined`);
        }
    }

    // Find new fields (in updated but not in current)
    for (const key of updated_keys) {
        if (!current_keys.has(key)) {
            const value = updated[key as keyof T];
            changes.push(`${key} = ${format_value(value)}`);
        }
    }

    // Find changed fields (in both, but different values)
    for (const key of current_keys) {
        if (updated_keys.has(key)) {
            const current_value = current[key as keyof T];
            const updated_value = updated[key as keyof T];
            if (!is_equal(current_value, updated_value)) {
                changes.push(`${key} = ${format_value(current_value)} -> ${format_value(updated_value)}`);
            }
        }
    }

    return changes;
}

function format_value(value: unknown): string {
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
    } else if (typeof value === "string") {
        return shorten(value, 30);
    } else if (value instanceof Date) {
        return value.toISOString();
    } else if (Array.isArray(value)) {
        return `[${value.length} items]`;
    } else if (typeof value === "object" && value !== null) {
        return "[object]";
    } else if (value === null) {
        return "null";
    } else if (value === undefined) {
        return "undefined";
    }
    return "[unknown type]";
}