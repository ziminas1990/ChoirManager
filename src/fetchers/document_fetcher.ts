import { Expected, Status } from "@src/utils/expected.js";
import { GoogleDocument } from "@src/api/google_docs.js";

export type AssistantConfigJson = {
    model: string;
    fetch_interval_sec: number;
    faq_document_id: string;
}

export class AssistantConfig {
    constructor(private readonly json: AssistantConfigJson) {}

    get model(): string {
        return this.json.model;
    }

    get fetch_interval_sec(): number {
        return this.json.fetch_interval_sec;
    }

    get faq_document_id(): string {
        return this.json.faq_document_id;
    }

    verify(): Status {
        const fail_prefix = "assistant misconfiguration";

        if (!this.json.model) {
            return Expected.err(`${fail_prefix}: 'model' MUST be specified`);
        }
        if (!this.json.faq_document_id) {
            return Expected.err(`${fail_prefix}: 'faq_document_id' MUST be specified`);
        }
        if (!this.json.fetch_interval_sec) {
            return Expected.err(`${fail_prefix}: 'fetch_interval_sec' MUST be specified`);
        }
        if (this.json.fetch_interval_sec < 60) {
            return Expected.err(`${fail_prefix}: 'fetch_interval_sec' MUST be at least 60 seconds`);
        }
        return Expected.ok(undefined);
    }
}

type Document = {
    api: GoogleDocument
    content?: string
}

export class DocumentsFetcher {

    private faq_document: Document

    private next_fetch_time: Date = new Date(0);

    constructor(private readonly config: AssistantConfig) {
        this.next_fetch_time = new Date(Date.now());
        this.faq_document = {
            api: new GoogleDocument(this.config.faq_document_id),
            content: undefined
        };
    }

    public async start(): Promise<Status> {
        return this.refetch_if_needed(new Date());
    }

    public async proceed(now: Date): Promise<Status> {
        return this.refetch_if_needed(now);
    }

    public get_faq_document(): Expected<string> {
        if (!this.faq_document.content) {
            return Expected.err("faq document is not fetched");
        }
        return Expected.ok(this.faq_document.content);
    }

    private async refetch_if_needed(now: Date): Promise<Status> {
        if (this.next_fetch_time > new Date()) {
            return Expected.ok(undefined);  // not a problem, just not a time to fetch
        }
        this.next_fetch_time = new Date(now.getTime() + this.config.fetch_interval_sec * 1000);

        try {
            const faq_status = await this.faq_document.api.read_as_simple_markdown();
            if (!faq_status.ok) {
                return faq_status.wrap_error("can't fetch faq document");
            }

            this.faq_document.content = faq_status.value?.join("\n") || "";
            return Expected.ok(undefined);
        } catch (err) {
            return (((err) instanceof Error) ? Expected.err((err).message) : Expected.err(String(err))).wrap_error("failed to fetch documents");
        }

    }


}
