// import { Status } from "../../status.js";
// import { Feedback } from "../entities/feedback.js";
// import { Journal } from "../journal.js";
// import { Runtime } from "../runtime.js";


// export class FeedbackActions {

//     static async register_new_feedback(
//         runtime: Runtime, feedback: Feedback, journal: Journal
//     ): Promise<Status> {
//         const storage = runtime.get_feedback_storage();
//         if (!storage) {
//             return Status.fail("Feedback storage is not configured");
//         }

//         const status = await storage.add_feedback(feedback);
//         if (!status.ok()) {
//             return status.wrap("Failed to add feedback to storage");
//         }

//         const managers_chat = runtime.get_managers_chat();
//         if (managers_chat) {
//             const status = await managers_chat.send_new_feedback_notification(feedback);
//             if (!status.ok()) {
//                 journal.log().warn(
//                     `Failed to send feedback notification to managers: ${status.what()}`);
//             }
//         }

//         return Status.ok();
//     }

// }