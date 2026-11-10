import { Expected, Status } from "@src/utils/expected.js";

export type Message = {
    time: Date;
    message_id: string;
    sender_id: string;
    text: string;
    // null: known non-reply; absent: relationship is unknown (legacy record).
    reply_to?: string | null;
}

export interface IMessagesBacklog {
    init(): Promise<Status>;

    add_message(message: Message): Promise<Status>;

    // Update text while preserving the stored timestamp, author and reply link.
    update_message(message: Message): Promise<Status>;

    get_messages(from: Date, to: Date): Promise<Expected<Message[]>>;

    // Missing IDs are omitted; storage failures return an error.
    get_messages_by_ids(ids: string[]): Promise<Expected<Message[]>>;
}
