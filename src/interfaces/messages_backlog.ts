import { Status, StatusWith } from "@src/status.js";

export type Message = {
    time: Date;
    message_id: string;
    sender_id: string;
    text: string;
}

export interface IMessagesBacklog {
    init(): Promise<Status>;

    add_message(message: Message): Promise<Status>;

    update_message(message: Message): Promise<Status>;

    get_messages(from: Date, to: Date): Promise<StatusWith<Message[]>>;
}
