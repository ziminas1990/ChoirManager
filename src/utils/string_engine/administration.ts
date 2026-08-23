import {
    AdministrationOperation,
    OperationResult,
    UserCasPatch,
} from "@src/interfaces/administration_service.js";
import { Role, UserData } from "@src/entities/user.js";

type ChangedField = {
    label: string;
    old_value: string;
    new_value: string;
};

export function render_confirmation(operation: AdministrationOperation): string {
    if (operation.what === "create_user") {
        return [
            "Подтвердите создание пользователя:",
            "",
            ...format_user_lines(operation.user, false),
        ].join("\n");
    }

    const lines = [
        "Подтвердите изменение пользователя:",
        "",
        `${bold("ID:")} ${escape_html(operation.system_id)}`,
        ...format_change_lines(collect_patch_changes(operation.patch)),
    ];
    return lines.join("\n");
}

export function render_result(result: OperationResult): string {
    if (result.what === "user_created") {
        return [
            "Пользователь создан:",
            "",
            ...format_user_lines(result.user, true),
        ].join("\n");
    }

    const lines = [
        "Пользователь обновлён:",
        "",
        `${bold("ID:")} ${escape_html(result.after.id.system_id)}`,
        ...format_change_lines(collect_user_changes(result.before, result.after, result.patch)),
    ];
    return lines.join("\n");
}

export function render_rejected(): string {
    return "Операция отклонена.";
}

export function render_timeout(): string {
    return "Время подтверждения истекло.";
}

function escape_html(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function bold(text: string): string {
    return `<b>${escape_html(text)}</b>`;
}

function format_user_lines(user: UserData, include_system_id: boolean): string[] {
    const lines: string[] = [];
    if (include_system_id && user.id.system_id.length > 0) {
        lines.push(`${bold("ID:")} ${escape_html(user.id.system_id)}`);
    }
    lines.push(
        `${bold("Имя:")} ${escape_html(user.name)}`,
        `${bold("Фамилия:")} ${escape_html(user.surname)}`,
        `${bold("Telegram:")} ${escape_html(format_username(user.id.tg_username))}`,
        `${bold("Язык:")} ${escape_html(user.lang)}`,
        `${bold("Голос:")} ${escape_html(user.voice)}`,
        `${bold("Роли:")} ${escape_html(format_roles_list(user.roles))}`,
    );
    return lines;
}

function format_change_lines(changes: ChangedField[]): string[] {
    return changes.map((change) => {
        const label = `${bold(`${change.label}:`)}`;
        if (change.old_value === change.new_value) {
            return `${label} ${escape_html(change.new_value)}`;
        }
        return `${label} ${escape_html(change.old_value)} -&gt; ${escape_html(change.new_value)}`;
    });
}

function collect_patch_changes(patch: UserCasPatch): ChangedField[] {
    const changes: ChangedField[] = [];
    push_cas_change(changes, "Имя", patch.name, format_text);
    push_cas_change(changes, "Фамилия", patch.surname, format_text);
    push_cas_change(changes, "Язык", patch.lang, format_text);
    push_cas_change(changes, "Голос", patch.voice, format_text);
    if (patch.id) {
        push_cas_change(changes, "ID", patch.id.system_id, format_text);
        push_cas_change(changes, "Telegram", patch.id.tg_username, format_username);
    }

    const roles_change = format_roles_patch(patch.roles);
    if (roles_change) {
        changes.push(roles_change);
    }
    return changes;
}

function collect_user_changes(
    before: UserData,
    after: UserData,
    patch: UserCasPatch,
): ChangedField[] {
    const from_snapshot: ChangedField[] = [];
    push_value_change(from_snapshot, "Имя", before.name, after.name, format_text);
    push_value_change(from_snapshot, "Фамилия", before.surname, after.surname, format_text);
    push_value_change(from_snapshot, "Язык", before.lang, after.lang, format_text);
    push_value_change(from_snapshot, "Голос", before.voice, after.voice, format_text);
    push_value_change(
        from_snapshot,
        "Telegram",
        before.id.tg_username,
        after.id.tg_username,
        format_username,
    );
    push_value_change(
        from_snapshot,
        "Роли",
        format_roles_list(before.roles),
        format_roles_list(after.roles),
        format_text,
    );

    if (from_snapshot.length > 0) {
        return from_snapshot;
    }
    return collect_patch_changes(patch);
}

function push_cas_change<T>(
    changes: ChangedField[],
    label: string,
    cas: [T, T] | undefined,
    format: (value: T) => string,
): void {
    if (!cas) {
        return;
    }
    push_value_change(changes, label, cas[0], cas[1], format);
}

function push_value_change<T>(
    changes: ChangedField[],
    label: string,
    old_value: T,
    new_value: T,
    format: (value: T) => string,
): void {
    const old_text = format(old_value);
    const new_text = format(new_value);
    if (old_text === new_text) {
        return;
    }
    changes.push({ label, old_value: old_text, new_value: new_text });
}

function format_roles_patch(patch: UserCasPatch["roles"]): ChangedField | undefined {
    if (!patch) {
        return undefined;
    }

    const parts: string[] = [];
    for (const item of patch.remove ?? []) {
        parts.push(`-${item.value}`);
    }
    for (const item of patch.replace ?? []) {
        const [expected, next] = item.patch;
        if (expected !== next) {
            parts.push(`${expected} -> ${next}`);
        }
    }
    for (const role of patch.append ?? []) {
        parts.push(`+${role}`);
    }
    if (parts.length === 0) {
        return undefined;
    }
    return {
        label: "Роли",
        old_value: parts.join(", "),
        new_value: parts.join(", "),
    };
}

function format_roles_list(roles: Role[]): string {
    if (roles.length === 0) {
        return "(empty)";
    }
    return roles.join(", ");
}

function format_text(value: unknown): string {
    if (value == undefined || value === "") {
        return "(empty)";
    }
    return String(value);
}

function format_username(value: string | undefined): string {
    if (value == undefined || value.length === 0) {
        return "(empty)";
    }
    return value.startsWith("@") ? value : `@${value}`;
}
