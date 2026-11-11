export type JournalFields = Readonly<Record<string, unknown>>;

export type JournalLevel = "info" | "error" | "debug" | "warning";

export interface IJournal {
    info(message: string): void;
    info(fields: JournalFields, message: string): void;

    error(message: string): void;
    error(fields: JournalFields, message: string): void;

    debug(message: string): void;
    debug(fields: JournalFields, message: string): void;

    warning(message: string): void;
    warning(fields: JournalFields, message: string): void;

    child(component: string, bindings?: JournalFields): IJournal;
}
