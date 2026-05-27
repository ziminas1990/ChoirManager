import { Expected, Status } from "@src/utils/expected.js";
import { Feedback } from "@src/entities/feedback.js";


export interface IFeedbackStorage {
    init(): Promise<Status>;

    get_feedbacks(): Promise<Expected<Feedback[]>>;

    add_feedback(feedback: Feedback): Promise<Status>;
}
