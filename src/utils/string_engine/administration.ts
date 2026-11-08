import {
    AdministrationOperation,
    OperationResult,
    UserCasPatch,
} from "@src/interfaces/administration_service.js";
import { is_guest_user, Role, UserData } from "@src/entities/user.js";
import { apply_cas_patch } from "@src/utils/cas_patch.js";

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

    // Roleless profiles already exist. Adding one is neither a new user nor a
    // change to a member, so the header says which case this is.
    const header = is_guest_user(operation.target)
        ? "Подтвердите добавление существующего профиля:"
        : "Подтвердите изменение пользователя:";
    const preview = apply_cas_patch(operation.target, operation.patch);
    if (!preview.ok) {
        return [
            header,
            "",
            format_identity(operation.target),
            "",
            "Не удалось показать предлагаемые изменения:",
            preview.error,
        ].join("\n");
    }

    const after = preview.value;
    return [
        header,
        "",
        format_identity(operation.target),
        "",
        ...format_change_lines(collect_profile_changes(operation.target, after)),
        format_resulting_roles(operation.target.roles, after.roles),
    ].join("\n");
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

export function render_failure(reason: string): string {
    const detail = reason.trim();
    if (detail.length === 0) {
        return "Не удалось выполнить операцию.";
    }
    return `Не удалось выполнить операцию: ${escape_html(detail)}`;
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
        lines.push(format_labeled_value("ID", user.id.system_id));
    }
    lines.push(
        format_identity(user),
        format_labeled_value("Язык", format_text(user.lang)),
        format_labeled_value("Голос", format_text(user.voice)),
        format_labeled_value("Роли", format_roles_list(user.roles)),
    );
    return lines;
}

// Who the confirmation is about. system_id is never included.
function format_identity(user: UserData): string {
    return [
        format_text(user.name),
        user.surname ? format_text(user.surname) : "",
        format_username(user.id.tg_username),
    ].filter(line => line.length > 0).join(" ");
}

function format_labeled_value(label: string, value: string): string {
    return `${bold(`${label}:`)} ${escape_html(value)}`;
}

function collect_profile_changes(before: UserData, after: UserData): ChangedField[] {
    const changes: ChangedField[] = [];
    push_value_change(changes, "Имя", before.name, after.name, format_text);
    push_value_change(changes, "Фамилия", before.surname, after.surname, format_text);
    push_value_change(
        changes,
        "Telegram",
        before.id.tg_username,
        after.id.tg_username,
        format_username,
    );
    push_value_change(changes, "Язык", before.lang, after.lang, format_text);
    push_value_change(changes, "Голос", before.voice, after.voice, format_text);
    return changes;
}

// Always the full role set. An arrow appears only when the set changes,
// and the right-hand side is the complete result, not a +/- delta.
function format_resulting_roles(before: Role[], after: Role[]): string {
    return format_change_lines([{
        label: "Роли",
        old_value: format_roles_list(before),
        new_value: format_roles_list(after),
    }])[0];
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
