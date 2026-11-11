import { IJournal } from "@src/interfaces/journal.js";
import { Expected, Status } from "@src/utils/expected.js";

export const OPENAI_MODELS = [
    { id: "gpt-6.1-sol", api: "responses", deprecated: false },
    { id: "gpt-6.1-terra", api: "responses", deprecated: false },
    { id: "gpt-6-luna", api: "responses", deprecated: false },
    { id: "gpt-5.6-luna", api: "chat_completions", deprecated: true },
    { id: "gpt-5.6-terra", api: "chat_completions", deprecated: true },
    { id: "gpt-4o", api: "chat_completions", deprecated: true },
    { id: "gpt-4o-mini", api: "chat_completions", deprecated: true },
] as const;

const warned_models = new WeakMap<IJournal, Set<string>>();

export function uses_openai_responses_api(model: string): boolean {
    return OPENAI_MODELS.some(entry => entry.id === model && entry.api === "responses");
}

export function verify_openai_model(model: unknown, journal?: IJournal): Status {
    const selected = typeof model === "string"
        ? OPENAI_MODELS.find(entry => entry.id === model.toLowerCase()) : undefined;
    if (!selected) {
        return Expected.err(`'model' MUST be specified and match one of: ${OPENAI_MODELS.map(entry => entry.id).join(", ")}`);
    }
    if (selected.deprecated && journal) {
        let warned = warned_models.get(journal);
        if (!warned) {
            warned = new Set<string>();
            warned_models.set(journal, warned);
        }
        if (warned.has(selected.id)) return Expected.ok(undefined);
        warned.add(selected.id);
        journal.child("openai_models").warning({ model: selected.id },
            "Model is deprecated in ChoirManager; use gpt-6.1-terra, gpt-6.1-sol, or gpt-6-luna");
    }
    return Expected.ok(undefined);
}
