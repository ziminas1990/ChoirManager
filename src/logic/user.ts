import { Logic } from '@src/logic/abstracts.js';
import { Database, Role, User } from '@src/database.js';
import { Status, StatusWith } from '@src/status.js';
import { DepositsFetcher } from '@src/fetchers/deposits_fetcher.js';
import { DepositsTracker } from '@src/logic/deposits_tracker.js';
import { Journal } from "@src/journal.js";
import { DepositActions } from '@src/use_cases/deposit_actions.js';
import { IAccounterAgent, IAdminAgent, IChorister, IDepositOwnerAgent, IUserAgent } from '@src/interfaces/user_agent.js';

export class UserLogic extends Logic<void> {
    private deposit_tracker: DepositsTracker;
    private journal: Journal;

    private agents: IUserAgent[] = [];

    constructor(
        public readonly data: User,
        proceed_interval_ms: number,
        parent_journal: Journal)
    {
        super(proceed_interval_ms);

        const additional_tags: Record<string, any> = {};
        if (this.is_guest()) {
            additional_tags.role = "guest";
        }

        this.journal = parent_journal.child(`@${data.tgid}`, additional_tags);

        this.deposit_tracker = new DepositsTracker(this.data.tgid, this.journal);
    }

    get_journal(): Journal {
        return this.journal;
    }

    attach_deposit_fetcher(fetcher: DepositsFetcher): void {
        this.deposit_tracker.attach_deposit_fetcher(fetcher);
    }

    is_guest(): boolean {
        return this.data.is(Role.Guest);
    }

    is_admin(): boolean {
        return this.data.is(Role.Admin);
    }

    is_accountant(): boolean {
        return this.data.is(Role.Accountant)
    }

    is_member(): boolean {
        return this.data.is(Role.Chorister) || this.data.is(Role.Conductor);
    }

    is_chorister(): boolean {
        return this.data.is(Role.Chorister);
    }

    is_ex_chorister(): boolean {
        return this.data.is(Role.ExChorister);
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

    get_deposit_tracker(): DepositsTracker | undefined {
        return this.deposit_tracker;
    }

    add_agent(agent: IUserAgent): void {
        this.agents.push(agent);
    }

    async proceed_impl(now: Date): Promise<Status> {
        const warnings: Status[] = [];

        {
            const events = await this.deposit_tracker.proceed(now);
            if (!events.ok()) {
                warnings.push(events.wrap("deposit_tracker"));
            }
            for (const event of events.value ?? []) {
                DepositActions.handle_deposit_tracker_event(this, event, this.journal);
            }
        }

        for (const agent of this.agents) {
            await agent.proceed(now);
        }

        return Status.ok_and_warnings("dialog proceed", warnings);
    }

    static pack(user: UserLogic) {
        return {
            "tgid": user.data.tgid,
            "deposit_tracker": DepositsTracker.pack(user.deposit_tracker)
        } as const;
    }

    static unpack(
        database: Database,
        packed: ReturnType<typeof UserLogic.pack>,
        parent_journal: Journal
    ): StatusWith<UserLogic> {
        const tgid = packed.tgid;

        const user = tgid ? database.get_user(tgid) : undefined;
        if (!user) {
            return StatusWith.fail(`User @${tgid} not found`);
        }
        const logic = new UserLogic(user, 100, parent_journal);

        if (packed.deposit_tracker) {
            logic.deposit_tracker = DepositsTracker.unpack(tgid, packed.deposit_tracker, parent_journal);
        }

        return Status.ok().with(logic);
    }
}
