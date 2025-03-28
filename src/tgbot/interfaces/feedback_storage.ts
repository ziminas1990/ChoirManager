import { Status, StatusWith } from "@src/status.js";
import { Feedback } from "@src/tgbot/entities/feedback.js";


export interface IFeedbackStorage {
    init(): Promise<Status>;

    get_feedbacks(): Promise<StatusWith<Feedback[]>>;

    add_feedback(feedback: Feedback): Promise<Status>;
}
