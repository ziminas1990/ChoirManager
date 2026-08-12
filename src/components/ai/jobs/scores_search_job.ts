import { Score } from "@src/entities/score.js";
import { ILLM, Message } from "@src/interfaces/llm.js";
import { EvaluationResult, ILlmJob } from "@src/interfaces/llm_job.js";
import { Expected } from "@src/utils/expected.js";
import { run_llm } from "@src/utils/llm/run_llm.js";

export type ScoresSearchInput = {
    query: string;
    scores: Score[];
};

export type ScoresSearchOutput = {
    indices: number[];
};

type LlmResponse = {
    indices: number[];
};

type SerializableScore = {
    index: number;
    name: string;
    author: string;
    hints: string;
    duration: number;
    file?: string;
};

function serialize_score(score: Score, index: number): SerializableScore {
    return {
        index,
        name: score.name,
        author: score.author,
        hints: score.hints,
        duration: score.duration,
        file: score.file,
    };
}

function parse_llm_response(content: string): Expected<LlmResponse> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(content);
    } catch (e) {
        return Expected.exception("failed to parse scores search response", e);
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return Expected.err("scores search response must be a JSON object");
    }

    const response = parsed as Record<string, unknown>;
    if (!Array.isArray(response.indices)) {
        return Expected.err("scores search response must include an indices array");
    }

    const indices: number[] = [];
    for (const index of response.indices) {
        if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
            return Expected.err("scores search indices must be non-negative integers");
        }
        indices.push(index);
    }

    return Expected.ok({ indices });
}

export class ScoresSearchJob implements ILlmJob<ScoresSearchInput, ScoresSearchOutput> {
    constructor(
        private readonly llm: ILLM,
        private readonly prompt: string,
    ) {}

    async evaluate(
        input: ScoresSearchInput,
    ): Promise<Expected<EvaluationResult<ScoresSearchOutput>>> {
        const dialog: Message[] = [
            { role: "system", content: this.prompt },
            {
                role: "user",
                content: JSON.stringify({
                    query: input.query,
                    scores: input.scores.map(serialize_score),
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

        const indices: number[] = [];
        for (const index of parsed.value.indices) {
            if (index >= input.scores.length) {
                continue;
            }
            if (!indices.includes(index)) {
                indices.push(index);
            }
        }

        return Expected.ok({
            actual_input: dialog.slice(1),
            actual_output: response.value.content!,
            output: { indices },
            model: response.value.model,
            usage: response.value.total_usage,
            cost_cents: response.value.cost_cents,
        });
    }
}
