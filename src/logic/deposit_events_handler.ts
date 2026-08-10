import { DepositEvent } from "@src/interfaces/deposit_service.js";
import { IBroadcaster, ISubscription } from "@src/interfaces/message_queue.js";
import { Journal } from "@src/journal.js";
import { DepositActions } from "@src/use_cases/deposit_actions.js";
import { Expected, Status } from "@src/utils/expected.js";

// Drains DepositService events and forwards them to DepositActions for UI notify.
export class DepositEventsHandler {
    private readonly journal: Journal;
    private readonly subscription: ISubscription<DepositEvent>;

    constructor(
        events: IBroadcaster<DepositEvent>,
        parent_journal: Journal,
    ) {
        this.journal = parent_journal.child("deposit_events");
        this.subscription = events.subscribe();
    }

    async proceed(): Promise<Status> {
        while (true) {
            const polled = await this.subscription.poll();
            if (!polled.ok) {
                return polled.wrap_error("failed to poll deposit events").as_status();
            }
            if (!polled.value) {
                return Expected.ok(undefined);
            }

            const event = polled.value;
            const status = await DepositActions.handle_deposit_event(event, this.journal);
            if (!status.ok) {
                this.journal.log().error(
                    `failed to handle deposit event for ${event.tgid}: ${status.error}`);
            }
        }
    }
}
