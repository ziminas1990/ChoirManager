import assert from "node:assert/strict";

function is_record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function object(value: unknown): Record<string, unknown> {
    assert.ok(is_record(value), "Expected an object");
    return value;
}
