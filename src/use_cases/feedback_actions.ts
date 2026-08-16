import { Expected, Status } from "@src/utils/expected.js";
import { Feedback } from "@src/entities/feedback.js";
import { Journal } from "@src/journal.js";
import { IUserAgent } from "@src/interfaces/user_agent.js";
import { Runtime } from "@src/runtime.js";
import { Environment } from "@src/components/environment.js";


export class FeedbackActions {

    static async register_new_feedback(
        who: IUserAgent, feedback: Feedback, journal: Journal
    ): Promise<Status> {
        const runtime = Runtime.get_instance();

        const user_id = who.userid();
        const resolved = await Environment.global.user_service.resolve_user({ system_id: user_id });
        if (!resolved.ok || !resolved.value) {
            return Expected.err(`user ${user_id} not found`);
        }

        const storage = runtime.get_feedback_storage();
        if (!storage) {
            return Expected.err("Feedback storage is not configured");
        }

        const status = await storage.add_feedback(feedback);
        if (!status.ok) {
            return status.wrap_error("Failed to add feedback to storage");
        }

        // Notify managers about new feedback
        const adapters = runtime.get_adapters();
        for (const adapter of adapters) {
            const managers_chat = await adapter.get_managers_chat();
            if (managers_chat) {
                const status = await managers_chat.on_new_feedback(feedback);
                if (!status.ok) {
                    journal.log().warn([
                        `Failed to notify managers about feedback`,
                        status.error
                    ].join(": "));
                }
            }
        }

        // Notify user that feedback was received
        const user_logic = runtime.get_user_logic(user_id);
        for (const chorister of user_logic?.as_chorister() ?? []) {
            const status = await chorister.on_feedback_received(feedback);
            if (!status.ok) {
                journal.log().warn([
                    `Failed to notify ${chorister.base().agent_name()} about feedback`,
                    status.error
                ].join(": "));
            }
        }

        return Expected.ok(undefined);
    }
}
