import { Logic } from '@src/logic/abstracts.js';
import { Role, UserData, user_has_role, user_tg_username } from '@src/entities/user.js';
import { Expected } from "@src/utils/expected.js";
import { Journal } from "@src/journal.js";
import { IAccounterAgent, IAdminAgent, IChorister, IDepositOwnerAgent, IUserAgent } from '@src/interfaces/user_agent.js';
import { IUserServiceReplica } from '@src/interfaces/user_service.js';

export type PackedUserLogic = {
    system_id?: string;
    // runtime.json v3 stored telegram username here
    tgid?: string;
};

export class UserLogic extends Logic<void> {
    private static readonly USER_REFRESH_INTERVAL_MS = 10_000;

    private journal: Journal;

    private agents: IUserAgent[] = [];
    private last_user_refresh_at_ms: number | undefined;

    constructor(
        private readonly system_id: string,
        public data: UserData,
        proceed_interval_ms: number,
        parent_journal: Journal,
        private readonly users: IUserServiceReplica,
    )
    {
        super(proceed_interval_ms);

        const additional_tags: Record<string, any> = {};
        if (this.is_guest()) {
            additional_tags.role = "guest";
        }

        const username = user_tg_username(this.data);
        const label = username.length > 0 ? `@${username}` : this.system_id;
        this.journal = parent_journal.child(label, additional_tags);
        this.journal.log().info(`UserLogic created for ${this.system_id}`);
    }

    get_journal(): Journal {
        return this.journal;
    }

    is_guest(): boolean {
        return user_has_role(this.data, Role.Guest);
    }

    is_admin(): boolean {
        return user_has_role(this.data, Role.Admin);
    }

    is_accountant(): boolean {
        return user_has_role(this.data, Role.Accountant);
    }

    is_member(): boolean {
        return user_has_role(this.data, Role.Chorister) || user_has_role(this.data, Role.Conductor);
    }

    is_chorister(): boolean {
        return user_has_role(this.data, Role.Chorister);
    }

    is_ex_chorister(): boolean {
        return user_has_role(this.data, Role.ExChorister);
    }

    all_agents(): IUserAgent[] {
        return this.agents;
    }

    as_chorister(): IChorister[] {
        if (!this.is_chorister()) {
            return [];
        }

        return this.agents
            .map(agent => agent.as_chorister())
            .filter(agent => agent !== undefined);
    }

    as_admin(): IAdminAgent[] {
        if (!this.is_admin()) {
            return [];
        }

        return this.agents
            .map(agent => agent.as_admin())
            .filter(agent => agent !== undefined);
    }

    as_deposit_owner(): IDepositOwnerAgent[] {
        if (!this.is_chorister()) {
            return [];
        }

        return this.agents
            .map(agent => agent.as_deposit_owner())
            .filter(agent => agent !== undefined);
    }

    as_accounter(): IAccounterAgent[] {
        if (!this.is_accountant()) {
            return [];
        }

        return this.agents
            .map(agent => agent.as_accounter())
            .filter(agent => agent !== undefined);
    }

    add_agent(agent: IUserAgent): void {
        this.agents.push(agent);
    }

    async proceed_impl(now: Date, _interval_ms: number): Promise<Expected<void[]>> {
        this.refresh_user_data_if_due(now);

        for (const agent of this.agents) {
            await agent.proceed(now);
        }

        return Expected.ok([]);
    }

    static pack(user: UserLogic) {
        return {
            system_id: user.system_id,
        } as const;
    }

    static unpack(
        user: UserData,
        packed: PackedUserLogic,
        parent_journal: Journal,
        users: IUserServiceReplica,
    ): Expected<UserLogic> {
        const system_id = packed.system_id ?? user.id.system_id;
        if (!system_id) {
            return Expected.err("User system_id is missing");
        }

        const logic = new UserLogic(
            system_id,
            user,
            100,
            parent_journal,
            users,
        );

        return Expected.ok(logic);
    }

    // Reads UserServiceReplica at most once per USER_REFRESH_INTERVAL_MS.
    private refresh_user_data_if_due(now: Date): void {
        const now_ms = now.getTime();
        if (this.last_user_refresh_at_ms !== undefined
            && now_ms - this.last_user_refresh_at_ms < UserLogic.USER_REFRESH_INTERVAL_MS)
        {
            return;
        }

        this.last_user_refresh_at_ms = now_ms;

        const resolved = this.users.resolve_user({
            system_id: this.system_id,
        });
        if (resolved.ok && resolved.value) {
            this.data = resolved.value;
        }
    }
}
