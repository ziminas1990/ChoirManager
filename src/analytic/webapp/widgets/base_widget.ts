import { EventEmitter } from "stream";

export type BaseWidgetState = {
    widget_unique_name: string
    // ... to be extended by inheriter
}

function is_valid_html_class(name: string): boolean {
    const classNameRegex = /^(?!-\d)[a-zA-Z_][a-zA-Z0-9_-]*$/;
    return classNameRegex.test(name);
}

export abstract class BaseWidget<State extends BaseWidgetState> extends EventEmitter {

    constructor(protected frame: HTMLDivElement, protected state: BaseWidgetState) {
        super()
        // Check that unique name can be used as html class name:
        if (!is_valid_html_class(state.widget_unique_name)) {
            throw new Error(`Widget name ${state.widget_unique_name} is not a valid HTML class name`)
        }

        if (frame.className != undefined) {
            throw new Error("frame must NOT have class name!")
        }
        frame.className = state.widget_unique_name;
    }

    unique_widget_name(): string { return this.state.widget_unique_name; }

    abstract store(): State;
}