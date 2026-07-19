import { ILLM, Message } from "@src/interfaces/llm.js";
import { EvaluationResult, ILlmJob } from "@src/interfaces/llm_job.js";
import { MemoryFact } from "@src/entities/memory.js";
import { Expected } from "@src/utils/expected.js";
import { run_llm } from "@src/utils/llm/run_llm.js";

export type MemoryAskInput = {
    question: string;
    facts: MemoryFact[];
};

export type MemoryAskOutput = {
    answer: string;
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

export class MemoryAskJob implements ILlmJob<MemoryAskInput, MemoryAskOutput> {
    constructor(
        private readonly llm: ILLM,
        private readonly prompt: string,
    ) {}

    async evaluate(
        input: MemoryAskInput,
    ): Promise<Expected<EvaluationResult<MemoryAskOutput>>> {
        const dialog: Message[] = [
            { role: "system", content: this.prompt },
            {
                role: "user",
                content: JSON.stringify({
                    question: input.question,
                    facts: input.facts.map(serialize_fact),
                }),
            },
        ];

        const response = await run_llm(this.llm, dialog, {
            json_mode: false,
            attempts: 3,
        });
        if (!response.ok) {
            return response.wrap_error("llm request failed");
        }

        const answer = response.value.content!.trim();
        if (answer.length === 0) {
            return Expected.err("memory ask response is empty");
        }

        return Expected.ok({
            actual_input: dialog.slice(1),
            actual_output: response.value.content!,
            output: { answer },
            model: response.value.model,
            usage: response.value.total_usage,
            cost_cents: response.value.cost_cents,
        });
    }
}
