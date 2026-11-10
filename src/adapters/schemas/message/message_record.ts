export type MessageRecord =
    | ({ schema?: undefined } & MessageRecord_v0)
    | ({ schema: 1 } & MessageRecord_v1);

type MessageRecord_v0 = {
    time: Date;
    message_id: string;
    sender: string;
    text: string;
};

type MessageRecord_v1 = {
    time: Date;
    message_id: string;
    sender_id: string;
    text: string;
    reply_to?: string | null;
};
