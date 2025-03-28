import { Logic } from './abstracts.js';
import { Database, Role, User } from '@src/tgbot/database.js';
import { Status, StatusWith } from '@src/status.js';
import { DepositsFetcher } from '@src/tgbot/fetchers/deposits_fetcher.js';
import { DepositsTracker } from './deposits_tracker.js';
import { ChoristerAssistant } from '@src/tgbot/ai_assistants/chorister_assistant.js';
import { DocumentsFetcher } from '@src/tgbot/fetchers/document_fetcher.js';
import { OpenaiAPI } from '@src/tgbot/api/openai.js';
import { Journal } from "@src/tgbot/journal.js";
import { TelegramCallbacks } from '@src/tgbot/adapters/telegram/callbacks.js';
import { DepositActions } from '@src/tgbot/use_cases/deposit_actions.js';
import { IAccounterAgent, IAdminAgent, IBaseAgent, IDepositOwnerAgent, IUserAgent } from '@src/tgbot/interfaces/user_agent.js';

export class UserLogic extends Logic<void> {
    private last_activity?: Date;
    private deposit_tracker: DepositsTracker;
    private journal: Journal;
    private callbacks: TelegramCallbacks;
    private chorister_assustant?: ChoristerAssistant

    private agents: IUserAgent[] = [];

    constructor(
        public readonly data: User,
        proceed_interval_ms: number,
        parent_journal: Journal)
    {
        super(proceed_interval_ms);
        this.last_activity = new Date();

        const additional_tags: Record<string, any> = {};
        if (this.is_guest()) {
            additional_tags.role = "guest";
        }

        this.journal = parent_journal.child(`@${data.tgid}`, additional_tags);

        this.callbacks = new TelegramCallbacks(this.journal.child("callbacks"));

        this.deposit_tracker = new DepositsTracker(this.data.tgid, this.journal);
    }

    get_journal(): Journal {
        return this.journal;
    }

    callbacks_registry(): TelegramCallbacks {
        return this.callbacks;
    }

    attach_deposit_fetcher(fetcher: DepositsFetcher): void {
        this.deposit_tracker.attach_deposit_fetcher(fetcher);
    }

    attach_documents_fetcher(fetcher: DocumentsFetcher) {
        if (OpenaiAPI.is_available()) {
            const journal = this.journal.child("chorister");
            this.chorister_assustant = new ChoristerAssistant(fetcher, journal);
        }
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

    base_agents(): IBaseAgent[] {
        return this.agents;
    }

    as_admin(): IAdminAgent[] | undefined {
        return this.is_admin() ? this.agents : undefined;
    }

    as_deposit_owner(): IDepositOwnerAgent[] | undefined {
        return this.is_chorister() ? this.agents : undefined;
    }

    as_accounter(): IAccounterAgent[] | undefined {
        return this.is_accountant() ? this.agents : undefined;
    }

    get_last_activity() {
        return this.last_activity;
    }

    get_deposit_tracker(): DepositsTracker | undefined {
        return this.deposit_tracker;
    }

    get_chorister_assistant(): ChoristerAssistant | undefined {
        return this.chorister_assustant;
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

        const status = await this.callbacks.proceed(now);
        if (!status.ok()) {
            warnings.push(status.wrap("callbacks"));
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
