import { Status } from "@src/status.js";
import { Feedback } from "@src/entities/feedback.js";
import { Journal } from "@src/journal.js";
import { IUserAgent } from "@src/interfaces/user_agent.js";
import { Runtime } from "@src/runtime.js";


export class FeedbackActions {

    static async register_new_feedback(
        who: IUserAgent, feedback: Feedback, journal: Journal
    ): Promise<Status> {
        const runtime = Runtime.get_instance();

        const user_id = who.userid();
        const user = runtime.get_user(user_id, false);
        if (!user) {
            return Status.fail(`user ${user_id} not found`);
        }

        const storage = runtime.get_feedback_storage();
        if (!storage) {
            return Status.fail("Feedback storage is not configured");
        }

        const status = await storage.add_feedback(feedback);
        if (!status.ok()) {
            return status.wrap("Failed to add feedback to storage");
        }

        // Notify managers about new feedback
        const adapters = runtime.get_adapters();
        for (const adapter of adapters) {
            const managers_chat = await adapter.get_managers_chat();
            if (managers_chat) {
                const status = await managers_chat.on_new_feedback(feedback);
                if (!status.ok()) {
                    journal.log().warn([
                        `Failed to notify managers about feedback`,
                        status.what()
                    ].join(": "));
                }
            }
        }

        // Notify user that feedback was received
        for (const chorister of user.as_chorister()) {
            const status = await chorister.on_feedback_received(feedback);
            if (!status.ok()) {
                journal.log().warn([
                    `Failed to notify ${chorister.base().agent_name()} about feedback`,
                    status.what()
                ].join(": "));
            }
        }

        return Status.ok();
    }
}