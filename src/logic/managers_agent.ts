import { ManagersAgent } from "@src/components/ai/agents/managers_agent.js";
import { IJournal } from "@src/interfaces/journal.js";
import { Logic } from "@src/logic/abstracts.js";
import { Expected } from "@src/utils/expected.js";

export class ManagersAgentLogic extends Logic<void> {
    constructor(
        private readonly agent: ManagersAgent,
        private readonly journal: IJournal,
    ) {
        super(250);
    }

    protected async proceed_impl(): Promise<Expected<void[]>> {
        try {
            const status = await this.agent.proceed();
            if (!status.ok) {
                this.journal.error(`Managers agent proceed failed: ${status.error}`);
            }
        } catch (error) {
            this.journal.error({ error }, "Managers agent proceed threw an exception");
        }
        return Expected.ok([]);
    }
}
