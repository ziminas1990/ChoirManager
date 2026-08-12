import fs from "fs";

import { OpenaiAPI } from "@src/api/openai.js";
import { ScoresSearchJob } from "@src/components/ai/jobs/scores_search_job.js";
import { Score } from "@src/entities/score.js";
import { IScoresService } from "@src/interfaces/scores_service.js";
import { IScoresStorage } from "@src/interfaces/storage/scores_storage.js";
import { Journal } from "@src/journal.js";
import { Logic } from "@src/logic/abstracts.js";
import { Expected, Status } from "@src/utils/expected.js";


export class ScoresService extends Logic<void> implements IScoresService {
    private readonly journal: Journal;
    private scores = new Map<string, Score>();

    constructor(
        private readonly model: string,
        private readonly search_prompt_file: string,
        private readonly storage: IScoresStorage,
        fetch_interval_sec: number,
        parent_journal: Journal,
    ) {
        super(fetch_interval_sec * 1000);
        this.journal = parent_journal.child("scores_svc");
    }

    async init(): Promise<Status> {
        return await this.refetch();
    }

    async fetch_all(): Promise<Score[]> {
        return Array.from(this.scores.values());
    }

    async get(key: string): Promise<Expected<Score | undefined>> {
        return Expected.ok(this.scores.get(key));
    }

    async search(query: string): Promise<Expected<Score[]>> {
        const trimmed = query.trim();
        if (trimmed.length === 0) {
            return Expected.err("search query must be non-empty");
        }

        if (!OpenaiAPI.is_available()) {
            return Expected.err("OpenAI API is not available");
        }

        const catalog = Array.from(this.scores.values());
        if (catalog.length === 0) {
            return Expected.ok([]);
        }

        let prompt: string;
        try {
            prompt = fs.readFileSync(this.search_prompt_file, "utf-8").trim();
        } catch (e) {
            return Expected.exception("failed to read scores search prompt", e);
        }

        const job = new ScoresSearchJob(
            OpenaiAPI.get_llm(this.model),
            prompt,
        );
        const result = await job.evaluate({ query: trimmed, scores: catalog });
        if (!result.ok) {
            return result.cast_error<Score[]>().wrap_error("scores search job failed");
        }

        const matched: Score[] = [];
        for (const index of result.value.output.indices) {
            const score = catalog[index];
            if (!score) {
                continue;
            }
            matched.push(score);
        }

        this.journal.log().info(
            `scores search selected ${matched.length} scores` +
            ` (model=${result.value.model},` +
            ` in=${result.value.usage.input_tokens},` +
            ` out=${result.value.usage.output_tokens})`,
        );

        return Expected.ok(matched);
    }

    protected async proceed_impl(_now: Date, _interval_ms: number): Promise<Expected<void[]>> {
        const status = await this.refetch();
        if (!status.ok) {
            this.journal.log().warn(`Failed to refetch scores: ${status.error}`);
        }
        return Expected.ok([]);
    }

    private async refetch(): Promise<Status> {
        const fetched = await this.storage.fetch_all();
        if (!fetched.ok) {
            return fetched.wrap_error("can't fetch scores");
        }

        // Replace the cache entirely so removed/changed sheet rows stay correct.
        this.scores = new Map(fetched.value.map((score) => [score.get_key(), score]));
        this.journal.log().info({ scores_count: this.scores.size }, "Scores cache refreshed");
        return Expected.ok(undefined);
    }
}
