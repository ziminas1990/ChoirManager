import pino from "pino";
import { IJournal, JournalFields, JournalLevel } from "@src/interfaces/journal.js";

export type PinoJournalOptions = {
    level?: JournalLevel;
    destination?: { write(message: string): void };
}

export class PinoJournal implements IJournal {
    private readonly logger: pino.Logger;

    private constructor(
        private readonly component: string[],
        private readonly bindings: JournalFields,
        private readonly options: PinoJournalOptions,
    ) {
        const config: pino.LoggerOptions = {
            level: options.level === "warning" ? "warn" : options.level ?? "info",
            serializers: { error: pino.stdSerializers.err, err: pino.stdSerializers.err },
            formatters: {
                bindings: () => ({ ...bindings, component: component.join(".") }),
                level: label => ({ level: label.toUpperCase() }),
            },
        };
        this.logger = options.destination ? pino(config, options.destination) : pino(config);
    }

    static create(options: PinoJournalOptions = {}): PinoJournal {
        return new PinoJournal([], {}, options);
    }

    info(message: string): void;
    info(fields: JournalFields, message: string): void;
    info(fields: string | JournalFields, message?: string): void {
        if (typeof fields === "string") {
            this.logger.info(fields);
        } else {
            this.logger.info(fields, message);
        }
    }

    error(message: string): void;
    error(fields: JournalFields, message: string): void;
    error(fields: string | JournalFields, message?: string): void {
        if (typeof fields === "string") {
            this.logger.error(fields);
        } else {
            this.logger.error(fields, message);
        }
    }

    debug(message: string): void;
    debug(fields: JournalFields, message: string): void;
    debug(fields: string | JournalFields, message?: string): void {
        if (typeof fields === "string") {
            this.logger.debug(fields);
        } else {
            this.logger.debug(fields, message);
        }
    }

    warning(message: string): void;
    warning(fields: JournalFields, message: string): void;
    warning(fields: string | JournalFields, message?: string): void {
        if (typeof fields === "string") {
            this.logger.warn(fields);
        } else {
            this.logger.warn(fields, message);
        }
    }

    child(component: string, bindings: JournalFields = {}): IJournal {
        return new PinoJournal([...this.component, component],
            { ...this.bindings, ...bindings }, this.options);
    }
}
