
export type ActionId = string; // YYMMDD-HHMM-XXXXXX
export type ActionState = string;
export type ActionKind = string;
export type OperationKind = string;

export type Action = {
    id: ActionId;
    kind: ActionKind;
    state: ActionState;
    finished: boolean;
    initiator?: string;
    created_at: Date;
    timeout_at?: Date;
}

export type Command = {
    action_id: ActionId;
    actor: string;
    sequence: number;
    kind: OperationKind;
    data: unknown;
}

export type CommandStatus = {
    kind: "applied",
    new_state: ActionState;
} | {
    kind: "rejected";
    reason: string;
} | {
    kind: "wrong_sequence";
}

export type JournalRecordHeader = {
    timestamp: Date
    offset: number;
}

export type JournalRecord = JournalRecordHeader & Command & CommandStatus;

export interface Workflow {
    apply(action: Action, command: Command): CommandStatus;
}

export function generate_action_id(): ActionId {
    const now = new Date();
    const year = now.getFullYear().toString().slice(-2);
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const hour = now.getHours().toString().padStart(2, '0');
    const minute = now.getMinutes().toString().padStart(2, '0');
    const id = Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0').toUpperCase();
    return `${year}${month}${day}-${hour}${minute}-${id}`;
}