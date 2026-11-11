import assert from "node:assert/strict";

import { Expected } from "@src/utils/expected.js";

export function value<T>(result: Expected<T>): T {
    assert.equal(result.ok, true, result.ok ? undefined : result.error);
    return result.value;
}
