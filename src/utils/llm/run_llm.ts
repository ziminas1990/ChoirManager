import { ILLM, Message, Response } from "@src/interfaces/llm.js";
import { Expected } from "@src/utils/expected.js";
import { sleep } from "@src/utils/misc.js";

async function sleep_before_attempt(attempt: number): Promise<void> {
    // First attempt (attempt == 0) is never delayed.
    const delays_sec = [0, 1, 3, 5, 10];
    const delay = delays_sec[Math.min(attempt, delays_sec.length - 1)];
    if (delay > 0) {
        await sleep(delay * 1000);
    }
}

export async function run_llm(
    llm: ILLM,
    dialog: Message[],
    opts: {
        json_mode: boolean;
        attempts: number;
    },
): Promise<Expected<Response>> {
    let last_error: Expected<Response> | undefined;

    for (let i = 0; i < opts.attempts; i++) {
        await sleep_before_attempt(i);
        try {
            const response = await llm.generate_response(
                dialog,
                undefined,
                opts.json_mode ? "json" : "text",
            );
            if (!response.ok) {
                last_error = response.wrap_error("failed to generate response");
                continue;
            }
            if (response.value.content === null) {
                last_error = Expected.err("no content in the response");
                continue;
            }
            return Expected.ok(response.value);
        } catch (e) {
            last_error = Expected.exception("got an exception", e);
        }
    }

    return last_error!.wrap_error("llm request failed after retries");
}
