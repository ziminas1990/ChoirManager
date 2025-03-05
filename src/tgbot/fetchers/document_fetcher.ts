import { Status, StatusWith } from "../../status.js";
import { GoogleDocument } from "../api/google_docs.js";
import { Config } from "../config.js";

type Document = {
    api: GoogleDocument
    content?: string
}

export class DocumentsFetcher {

    private faq_document: Document

    private next_fetch_time: Date = new Date(0);

    constructor(private fetch_interval_sec: number) {
        this.next_fetch_time = new Date(Date.now());
        this.faq_document = {
            api: new GoogleDocument(Config.Assistant().faq_document_id),
            content: undefined
        };
    }

    public async start(): Promise<Status> {
        return this.refetch_if_needed(new Date());
    }

    public async proceed(now: Date): Promise<Status> {
        return this.refetch_if_needed(now);
    }

    public get_faq_document(): StatusWith<string> {
        if (!this.faq_document.content) {
            return Status.fail("faq document is not fetched");
        }
        return Status.ok().with(this.faq_document.content);
    }

    private async refetch_if_needed(now: Date): Promise<Status> {
        if (this.next_fetch_time > new Date()) {
            return Status.ok();  // not a problem, just not a time to fetch
        }
        this.next_fetch_time = new Date(now.getTime() + this.fetch_interval_sec * 1000);

        try {
            const faq_status = await this.faq_document.api.read_as_simple_markdown();
            if (!faq_status.ok()) {
                return faq_status.wrap("can't fetch faq document");
            }

            this.faq_document.content = faq_status.value?.join("\n") || "";
            return Status.ok();
        } catch (err) {
            return Status.exception(err).wrap("failed to fetch documents");
        }

    }


}
