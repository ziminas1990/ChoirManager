import { IMessagesBacklog } from "@src/interfaces/messages_backlog";
import { IUserAgent } from "@src/interfaces/user_agent";
import { Journal } from "@src/journal";
import { Logic } from "@src/logic/abstracts.js";
import { Status } from "@src/status.js";
import { StatusWith } from "@src/status.js";

export type GroupChatMessage = {
    time: Date;
    message_id: string,
    user_id: string,
    text: string;
}

export class GroupChat extends Logic<void> {

    private backlog?: IMessagesBacklog;

    // Queue of incoming messages, that should be processed by the logic
    private new_messages_queue: [IUserAgent, GroupChatMessage][] = [];
    private edited_messages_queue: [IUserAgent, GroupChatMessage][] = [];

    constructor(private journal: Journal)
    {
        super(1000);
    }

    attach_to_backlog(backlog: IMessagesBacklog): void {
        this.backlog = backlog;
    }

    // NOTE: this function must NOT be async, it should return immediately
    on_new_message(sender: IUserAgent, message: GroupChatMessage): void {
        this.new_messages_queue.push([sender, message]);
    }

    // NOTE: this function must NOT be async, it should return immediately
    on_message_edited(sender: IUserAgent, message: GroupChatMessage): void {
        this.edited_messages_queue.push([sender, message]);
    }

    async fetch_messages(from: Date, to: Date): Promise<StatusWith<GroupChatMessage[]>> {
        if (!this.backlog) {
            return Status.fail("backlog is not attached");
        }
        const messages = await this.backlog.get_messages(from, to);
        if (!messages.ok() || !messages.value) {
            return messages.wrap("can't fetch messages from backlog");
        }
        return Status.ok().with<GroupChatMessage[]>(messages.value.map(message => ({
            time: message.time,
            message_id: message.message_id,
            user_id: message.sender_id,
            text: message.text,
        })));
    }

    protected async proceed_impl(_: Date): Promise<StatusWith<void[]>> {
        // TODO: call in parallel?
        await this.add_new_messages_to_backlog();
        await this.update_edited_messages_in_backlog();
        return Status.ok().with<void[]>([]);
    }

    private async add_new_messages_to_backlog(): Promise<Status> {
        if (!this.backlog) {
            return Status.fail("backlog is not attached");
        }

        // TODO: handle messages in parallel?
        const promises = this.new_messages_queue.map(async ([_, message]) => {
            const status = await this.backlog!.add_message({
                time: message.time,
                message_id: message.message_id,
                sender_id: message.user_id,
                text: message.text,
            });
            if (!status.ok()) {
                this.journal.log().error("Failed to add message to backlog", {
                    status: status.what(),
                });
            }
        });
        await Promise.all(promises);

        this.new_messages_queue = [];
        return Status.ok();
    }

    private async update_edited_messages_in_backlog(): Promise<Status> {
        if (!this.backlog) {
            return Status.fail("backlog is not attached");
        }

        const promises = this.edited_messages_queue.map(async ([_, message]) => {
            const status = await this.backlog!.update_message({
                time: message.time,
                message_id: message.message_id,
                sender_id: message.user_id,
                text: message.text,
            });
            if (!status.ok()) {
                this.journal.log().error("Failed to update message in backlog", {
                    status: status.what(),
                });
            }
        });
        await Promise.all(promises);

        this.edited_messages_queue = [];
        return Status.ok();
    }
}