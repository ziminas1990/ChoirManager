import { escape_html } from "@src/utils.js";

export type CallbackButton = { text: string; callback_data: string; style?: "danger" };
export type GridButton = CallbackButton | { text: string; url: string };

// Rendering does not register actions or change their lifetime.
export function render_button_grid(grid: readonly (readonly GridButton[])[]): string {
    return grid.map(row => `<tg-button-row>${row.map(button => {
        const type = "url" in button ? "url" : "callback_data";
        const attribute = "url" in button ? "url" : "data";
        const data = "url" in button ? button.url : button.callback_data;
        const style = "style" in button && button.style ? ` style="${button.style}"` : "";
        return `<tg-button type="${type}"${style} ${attribute}="${escape_html(data)}">${escape_html(button.text)}</tg-button>`;
    }).join("")}</tg-button-row>`).join("\n");
}

export function with_button_grid(body: string, grid: readonly (readonly GridButton[])[]): string {
    const controls = render_button_grid(grid);
    return controls ? `${body}\n${controls}` : body;
}
