import fs from 'fs';
import { Feedback } from "@src/entities/feedback.js";
import { IFeedbackStorage } from "@src/interfaces/feedback_storage.js";
import { Expected, Status } from "@src/utils/expected.js";

export type Config = {
    filename: string
}

export class LocalJsonFileFeedbackStorage implements IFeedbackStorage {
    private cached_feedbacks?: Feedback[];

    constructor(private config: Config) {}

    async init(): Promise<Status> {
        return Expected.ok(undefined);
    }

    async get_feedbacks(): Promise<Expected<Feedback[]>> {
        if (this.cached_feedbacks) {
            return Expected.ok(this.cached_feedbacks);
        }

        try {
            const data = fs.readFileSync(this.config.filename, 'utf-8');
            if (!data) {
                this.cached_feedbacks = [];
                return Expected.ok([]);
            }
            this.cached_feedbacks = JSON.parse(data) as Feedback[];
            return Expected.ok(this.cached_feedbacks);
        } catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
                // File doesn't exist yet - that's ok, return empty array
                this.cached_feedbacks = [];
                return Expected.ok([]);
            }
            return Expected.exception("failed to load feedbacks from file", error).cast_error<Feedback[]>();
        }
    }

    async add_feedback(feedback: Feedback): Promise<Status> {
        try {
            const feedbacks_status = await this.get_feedbacks();
            const feedbacks = feedbacks_status.ok ? feedbacks_status.value : [];
            feedbacks.push(feedback);
            this.cached_feedbacks = feedbacks;
            fs.writeFileSync(this.config.filename, JSON.stringify(feedbacks, null, 2));
            return Expected.ok(undefined);
        } catch (error) {
            return Expected.err(`Failed to save feedback: ${error}`);
        }
    }
}