import pino from "pino";

export class Journal {
    private logger: pino.Logger;

    static Root(): Journal {
        return new Journal([], {});
    }

    private constructor(
        private component: string[],
        private additional_bindings: Record<string, any> = {}) {
        this.logger = pino({
            formatters: {
                bindings: () => ({
                    component: this.component.join("."),
                    ...this.additional_bindings,
                }),
                level: (label) => ({ level: label.toUpperCase() }),
            }
        });
    }

    public child(
        child_component: string,
        additional_bindings: Record<string, any> = {}): Journal
    {
        return new Journal([...this.component, child_component], {
            ...this.additional_bindings,
            ...additional_bindings,
        });
    }

    public log(): pino.Logger {
        return this.logger;
    }
}