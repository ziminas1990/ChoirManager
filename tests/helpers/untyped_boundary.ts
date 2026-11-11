import assert from "node:assert/strict";

import { Expected } from "@src/utils/expected.js";

// Negative tests deliberately send malformed runtime data across a typed API.
// Check the result instead of asserting that malformed data satisfies a contract.
export function invalid_result(method: (...args: never[]) => unknown, ...args: unknown[]): Expected<unknown> {
    const result: unknown = Reflect.apply(method, undefined, args);
    assert.ok(result instanceof Expected);
    return result;
}
