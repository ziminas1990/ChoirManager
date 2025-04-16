import { Status, StatusWith } from "@src/status.js";

export type RehersalInfo = {
    date: Date;
    songs: {
        name: string;
        minutes: number
    }[];
    participants: {
        tgid: string;
        minutes: number
    }[];
};

export interface IRehersalsStorage {

    init(): Promise<Status>;

    // Fetch all rehersals from storage
    // NOTE: this is an expensive operation, use some caching approach
    fetch(): Promise<StatusWith<RehersalInfo[]>>;

}