import fs from 'fs';
import { Feedback } from "@src/entities/feedback.js";
import { IFeedbackStorage } from "@src/interfaces/feedback_storage.js";
import { Status, StatusWith } from "@src/status.js";

export type Config = {
    filename: string
}

export class LocalJsonFileFeedbackStorage implements IFeedbackStorage {
    private cached_feedbacks?: Feedback[];

    constructor(private config: Config) {}

    async init(): Promise<Status> {
        return Status.ok();
    }

    async get_feedbacks(): Promise<StatusWith<Feedback[]>> {
        if (this.cached_feedbacks) {
            return Status.ok().with(this.cached_feedbacks);
        }

        try {
            const data = fs.readFileSync(this.config.filename, 'utf-8');
            if (!data) {
                this.cached_feedbacks = [];
                return Status.ok().with([]);
            }
            this.cached_feedbacks = JSON.parse(data) as Feedback[];
            return Status.ok().with(this.cached_feedbacks);
        } catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
                // File doesn't exist yet - that's ok, return empty array
                this.cached_feedbacks = [];
                return Status.ok().with([]);
            }
            return Status.exception(error).wrap("failed to load feedbacks from file").with([]);
        }
    }

    async add_feedback(feedback: Feedback): Promise<Status> {
        try {
            const feedbacks_status = await this.get_feedbacks();
            const feedbacks = feedbacks_status.value ?? [];
            feedbacks.push(feedback);
            this.cached_feedbacks = feedbacks;
            fs.writeFileSync(this.config.filename, JSON.stringify(feedbacks, null, 2));
            return Status.ok();
        } catch (error) {
            return Status.fail(`Failed to save feedback: ${error}`);
        }
    }
}