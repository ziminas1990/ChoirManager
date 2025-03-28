import { Feedback } from "@src/tgbot/entities/feedback.js";
import { IFeedbackStorage } from "@src/tgbot/interfaces/feedback_storage.js";
import { Status, StatusWith } from "@src/status.js";

export type Config = {
    spreadsheet_id: string
    sheet_name: string
}

export class GoogleSpreadsheetFeedbackStorage implements IFeedbackStorage {

    constructor(private config: Config) {
        console.log(this.config);
    }

    async init(): Promise<Status> {
        return Status.ok();
    }

    async get_feedbacks(): Promise<StatusWith<Feedback[]>> {
        return Status.ok().with([]);
    }

    async add_feedback(_: Feedback): Promise<Status> {
        return Status.ok();
    }

}