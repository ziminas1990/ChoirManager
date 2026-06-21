import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import { Tool } from "@src/interfaces/llm.js";
import { Expected } from "@src/utils/expected.js";

export const empty_parameters_schema = z.object({}).strict();

export function parameters_from_schema(schema: z.ZodObject<z.ZodRawShape>): Record<string, unknown> {
    const json_schema = zodToJsonSchema(schema, {
        $refStrategy: "none",
    }) as Record<string, unknown>;
    const { $schema, ...parameters } = json_schema;
    return parameters;
}

export function tool_from_schema(
    name: string,
    description: string,
    schema: z.ZodObject<z.ZodRawShape>,
): Tool {
    return {
        name,
        description,
        parameters: parameters_from_schema(schema),
    };
}

export function parse_tool_parameters<T extends z.ZodType>(
    schema: T,
    parameters: Record<string, unknown>,
): Expected<z.infer<T>> {
    const result = schema.safeParse(parameters);
    if (result.success) {
        return Expected.ok(result.data);
    }
    return Expected.err(format_zod_error(result.error));
}

function format_zod_error(error: z.ZodError): string {
    return error.issues
        .map(issue => {
            const path = issue.path.length > 0 ? issue.path.join(".") : "parameters";
            return `${path}: ${issue.message}`;
        })
        .join("; ");
}
