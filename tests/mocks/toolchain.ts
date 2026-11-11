import { IToolchain } from "@src/interfaces/llm.js";
import { Expected } from "@src/utils/expected.js";

import { unexpected } from "./unexpected.js";

export function mock_toolchain(overrides: Partial<IToolchain> = {}): IToolchain {
    return {
        get_name: unexpected,
        get_readme: unexpected,
        get_use_cases: unexpected,
        get_tools: unexpected,
        call_tool: unexpected,
        ...overrides,
    };
}

export function recording_toolchain(name: string, calls: string[], functions = [`${name}_call`]): IToolchain {
    return {
        get_name: () => name,
        get_readme: () => `${name} instructions`,
        get_use_cases: () => `${name} use cases`,
        get_tools: () => new Map(functions.map(function_name => [function_name, {
            name: function_name, description: function_name,
            parameters: { type: "object", properties: {} },
        }])),
        async call_tool(function_name) {
            calls.push(function_name);
            return Expected.ok(function_name);
        },
    };
}
