import { IDepositService } from "@src/interfaces/deposit_service.js";
import { IEnvironment } from "@src/interfaces/environment.js";
import { ISimpleMemoryService } from "@src/interfaces/simple_memory_service.js";
import { ITaskTrackerService } from "@src/interfaces/task_tracker_service.js";
import { IUserService } from "@src/interfaces/user_service.js";


// NOTE: Environment looks like singleton, but it is not fully a singleton.
// Component may get environment as IEnvironment object and use it as if it is a
// regular dependency. So, if you need to test the component or don't want it
// is explicitly use global context, just pass an IEnvironment object to the component.
export class Environment implements IEnvironment {
    private static global_instance?: Environment;

    private user_service_instance?: IUserService;
    private task_tracker_instance?: ITaskTrackerService;
    private simple_memory_instance?: ISimpleMemoryService;
    private deposit_service_instance?: IDepositService;

    static get global(): IEnvironment {
        return Environment.require_global();
    }

    static global_or(env: IEnvironment | undefined): IEnvironment {
        if (env) {
            return env;
        }
        return Environment.global;
    }

    // Concrete instance for bootstrap wiring (attach services during startup).
    static get setup(): Environment {
        return Environment.require_global();
    }

    static set_global(environment: Environment) {
        this.global_instance = environment;
    }

    set user_service(user_service: IUserService) {
        this.user_service_instance = user_service;
    }

    get user_service(): IUserService {
        if (!this.user_service_instance) {
            throw new Error("User service is not set");
        }
        return this.user_service_instance;
    }

    get maybe_user_service(): IUserService | undefined {
        return this.user_service_instance;
    }

    set task_tracker_service(task_tracker: ITaskTrackerService) {
        this.task_tracker_instance = task_tracker;
    }

    get task_tracker_service(): ITaskTrackerService {
        if (!this.task_tracker_instance) {
            throw new Error("Task tracker is not set");
        }
        return this.task_tracker_instance;
    }

    get maybe_task_tracker_service(): ITaskTrackerService | undefined {
        return this.task_tracker_instance;
    }

    set simple_memory_service(simple_memory: ISimpleMemoryService) {
        this.simple_memory_instance = simple_memory;
    }

    get simple_memory_service(): ISimpleMemoryService {
        if (!this.simple_memory_instance) {
            throw new Error("Simple memory is not set");
        }
        return this.simple_memory_instance;
    }

    get maybe_simple_memory_service(): ISimpleMemoryService | undefined {
        return this.simple_memory_instance;
    }

    set deposit_service(deposit_service: IDepositService) {
        this.deposit_service_instance = deposit_service;
    }

    get deposit_service(): IDepositService {
        if (!this.deposit_service_instance) {
            throw new Error("Deposit service is not set");
        }
        return this.deposit_service_instance;
    }

    get maybe_deposit_service(): IDepositService | undefined {
        return this.deposit_service_instance;
    }

    private static require_global(): Environment {
        if (!this.global_instance) {
            throw new Error("Environment is not set");
        }
        return this.global_instance;
    }
}
