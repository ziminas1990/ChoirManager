import { ILLM, Message } from "@src/interfaces/llm.js";
import { EvaluationResult, ILlmJob } from "@src/interfaces/llm_job.js";
import { MemoryFact } from "@src/entities/memory.js";
import { Expected } from "@src/utils/expected.js";
import { run_llm } from "@src/utils/llm/run_llm.js";

export type MemorySearchInput = {
    query: string;
    facts: MemoryFact[];
};

export type MemorySearchOutput = {
    ids: string[];
};

type LlmResponse = {
    ids: string[];
};

type SerializableMemoryFact = {
    id: string;
    author: string;
    created_at: string;
    content: string;
};

function serialize_fact(fact: MemoryFact): SerializableMemoryFact {
    return {
        id: fact.id,
        author: fact.author_name,
        created_at: fact.created_at.toISOString(),
        content: fact.content,
    };
}

function parse_llm_response(content: string): Expected<LlmResponse> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(content);
    } catch (e) {
        return Expected.exception("failed to parse memory search response", e);
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return Expected.err("memory search response must be a JSON object");
    }

    const response = parsed as Record<string, unknown>;
    if (!Array.isArray(response.ids)) {
        return Expected.err("memory search response must include an ids array");
    }

    const ids: string[] = [];
    for (const id of response.ids) {
        if (typeof id !== "string" || id.trim().length === 0) {
            return Expected.err("memory search ids must be non-empty strings");
        }
        ids.push(id.trim());
    }

    return Expected.ok({ ids });
}

export class MemorySearchJob implements ILlmJob<MemorySearchInput, MemorySearchOutput> {
    constructor(
        private readonly llm: ILLM,
        private readonly prompt: string,
    ) {}

    async evaluate(
        input: MemorySearchInput,
    ): Promise<Expected<EvaluationResult<MemorySearchOutput>>> {
        const dialog: Message[] = [
            { role: "system", content: this.prompt },
            {
                role: "user",
                content: JSON.stringify({
                    query: input.query,
                    facts: input.facts.map(serialize_fact),
                }),
            },
        ];

        const response = await run_llm(this.llm, dialog, {
            json_mode: true,
            attempts: 3,
        });
        if (!response.ok) {
            return response.wrap_error("llm request failed");
        }

        const parsed = parse_llm_response(response.value.content!);
        if (!parsed.ok) {
            return parsed.wrap_error("failed to parse response");
        }

        const known_ids = new Set(input.facts.map((fact) => fact.id));
        const ids: string[] = [];
        for (const id of parsed.value.ids) {
            if (!known_ids.has(id)) {
                continue;
            }
            if (!ids.includes(id)) {
                ids.push(id);
            }
        }

        return Expected.ok({
            actual_input: dialog.slice(1),
            actual_output: response.value.content!,
            output: { ids },
            model: response.value.model,
            usage: response.value.total_usage,
            cost_cents: response.value.cost_cents,
        });
    }
}
