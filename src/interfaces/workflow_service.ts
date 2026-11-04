import { ActionId, JournalRecord, Command, OperationKind } from "@src/components/workflows/basics.js";
import { Expected, Status } from "@src/utils/expected.js";


export interface IWorkflowService {

    post(operation: Command): Promise<Status>;

    pull_updates(offset: number, filter: {
        since?: Date;
        action_id?: ActionId;
        operation_kind?: OperationKind;
        initiator?: string;
    }): Promise<Expected<JournalRecord[]>>;

}