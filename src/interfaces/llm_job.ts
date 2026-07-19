import { Message, TokensUsage } from "@src/interfaces/llm.js";
import { Expected } from "@src/utils/expected.js";

export type EvaluationResult<Output> = {
    actual_input: Message[];
    actual_output: string;
    output: Output;
    model: string;
    usage: TokensUsage;
    cost_cents: number;
};

export interface ILlmJob<Input, Output> {
    evaluate(input: Input): Promise<Expected<EvaluationResult<Output>>>;
}
