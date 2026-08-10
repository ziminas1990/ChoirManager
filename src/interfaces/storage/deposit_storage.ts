import { Deposit } from "@src/entities/deposit.js";

// Pure persistence: parse and return deposits from the backend.
export interface IDepositStorage {
    fetch_all(): Promise<Deposit[]>;
}
