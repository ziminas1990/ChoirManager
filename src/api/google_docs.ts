import { Expected, Status } from "@src/utils/expected.js";
import { TokenBucket } from "@src/utils/token_bucket.js";
import { GoogleAuth } from "./google_auth.js";

export type Row = string[];
export type Table = Row[];


export class GoogleSpreadsheet {

    private static readonly api_tokens = new TokenBucket({
        max_tokens: 30,
        refill_rate: 10,
    });

    constructor(private sheet_id: string) {}

    private sheet_id_cache = new Map<string, number>();

    public async read(range: string): Promise<Expected<Table>> {
        await GoogleSpreadsheet.api_tokens.wait_tokens(1);
        try {
            const sheet = await GoogleAuth.get_sheets().spreadsheets.values.get({
                spreadsheetId: this.sheet_id,
                range: range
            });
            if (!sheet.data.values) {
                return Expected.err("can't fetch sheet data");
            }
            return Expected.ok(sheet.data.values);
        } catch (err) {
            return Expected.exception("Got an exception", err);
        }
    }

    public async append(range: string, row: Row): Promise<Status> {
        await GoogleSpreadsheet.api_tokens.wait_tokens(1);
        try {
            const sheet = await GoogleAuth.get_sheets().spreadsheets.values.append({
                spreadsheetId: this.sheet_id,
                range: range,
                valueInputOption: "USER_ENTERED",
                insertDataOption: "INSERT_ROWS",
                requestBody: { values: [row] }
            });
            if (sheet.status !== 200) {
                return Expected.err(`Failed to append row: ${sheet.status}`);
            }
            return Expected.ok(undefined);
        } catch (err) {
            return Expected.exception("Got an exception while appending row", err);
        }
    }

    public async write(range: string, row: Row): Promise<Status> {
        await GoogleSpreadsheet.api_tokens.wait_tokens(1);
        try {
            const sheet = await GoogleAuth.get_sheets().spreadsheets.values.update({
                spreadsheetId: this.sheet_id,
                range: range,
                valueInputOption: "USER_ENTERED",
                requestBody: { values: [row] },
            });
            if (sheet.status !== 200) {
                return Expected.err(`Failed to update row: ${sheet.status}`);
            }
            return Expected.ok(undefined);
        } catch (err) {
            return Expected.exception("Got an exception while updating row", err);
        }
    }

    public async delete_row(sheet_name: string, row_index: number): Promise<Status> {
        const sheet_id_status = await this.resolve_sheet_id(sheet_name);
        if (!sheet_id_status.ok) {
            return sheet_id_status.as_status();
        }

        try {
            await GoogleSpreadsheet.api_tokens.wait_tokens(1);
            const sheet = await GoogleAuth.get_sheets().spreadsheets.batchUpdate({
                spreadsheetId: this.sheet_id,
                requestBody: {
                    requests: [{
                        deleteDimension: {
                            range: {
                                sheetId: sheet_id_status.value,
                                dimension: "ROWS",
                                startIndex: row_index,
                                endIndex: row_index + 1,
                            },
                        },
                    }],
                },
            });
            if (sheet.status !== 200) {
                return Expected.err(`Failed to delete row: ${sheet.status}`);
            }
            return Expected.ok(undefined);
        } catch (err) {
            return Expected.exception("Got an exception while deleting row", err);
        }
    }

    private async resolve_sheet_id(sheet_name: string): Promise<Expected<number>> {
        const cached = this.sheet_id_cache.get(sheet_name);
        if (cached !== undefined) {
            return Expected.ok(cached);
        }

        try {
            await GoogleSpreadsheet.api_tokens.wait_tokens(1);
            const response = await GoogleAuth.get_sheets().spreadsheets.get({
                spreadsheetId: this.sheet_id,
            });
            const sheet = response.data.sheets?.find(
                entry => entry.properties?.title === sheet_name,
            );
            const sheet_id = sheet?.properties?.sheetId;
            if (sheet_id === undefined || sheet_id === null) {
                return Expected.err(`Sheet '${sheet_name}' not found`);
            }
            this.sheet_id_cache.set(sheet_name, sheet_id);
            return Expected.ok(sheet_id);
        } catch (err) {
            return Expected.exception("Got an exception while resolving sheet id", err);
        }
    }
}

// type MarkdownElement = {
//     what: "text",
//     text: string,
// } | {
//     what: "link",
//     text: string,
//     url: string,
// } | {
//     what: "list",
//     items: MarkdownElement[],
// } | {
//     what: "header",
//     level: number,
//     text: string,
// }

export class GoogleDocument {

    constructor(private document_id: string) {}

    public async read(): Promise<Expected<string>> {
        const res = await GoogleAuth.get_documents().documents.get({
            documentId: this.document_id
        });
        const content = res.data.body?.content || [];
        const text = content.map((el) => {
            return el.paragraph?.elements?.map((e) => {
                return e.textRun?.content || ""
            }).join("") || ""
        }).join("\n");

        return Expected.ok(text.trim());
    }

    // Return document as a simple markdown. Only lists, headers and links are supported,
    // tables, images and other complex elements are ignored.
    // Each element in the returned array is a section of the document and starts with a
    // level 1 header. If document has no headers, all content will be in a single section.
    // TODO: this code was completely generated by co-pilot (claude 3.7) and needs to be
    // rewritten to be more readable and maintainable.
    public async read_as_simple_markdown(): Promise<Expected<string[]>> {
        try {
            const res = await GoogleAuth.get_documents().documents.get({
                documentId: this.document_id
            });
            const content = res.data.body?.content || [];

            const sections: string[] = [];
            let currentSection = "";
            let inList = false;
            let listLevel = 0;

            for (const element of content) {
                // Skip elements without paragraphs
                if (!element.paragraph) {
                    continue;
                }

                const paragraph = element.paragraph;
                const style = paragraph.paragraphStyle;

                // Check if this is a header
                if (style?.namedStyleType?.includes('HEADING')) {
                    const headerLevel = parseInt(style.namedStyleType.replace('HEADING_', ''));

                    // If it's a level 1 header, start a new section
                    if (headerLevel === 1) {
                        if (currentSection) {
                            sections.push(currentSection.trim());
                        }
                        currentSection = "";
                    }

                    // Add the header with appropriate markdown formatting
                    currentSection += '#'.repeat(headerLevel) + ' ';
                    currentSection += this.extractTextFromParagraph(paragraph) + '\n\n';
                    inList = false;
                    continue;
                }

                // Handle lists
                if (paragraph.bullet) {
                    const newListLevel = paragraph.bullet.nestingLevel || 0;

                    // If list level changed, add appropriate spacing
                    if (!inList || newListLevel !== listLevel) {
                        if (!inList) currentSection += '\n';
                        inList = true;
                        listLevel = newListLevel;
                    }

                    // Add indentation based on nesting level
                    currentSection += '  '.repeat(listLevel) + '* ';
                    currentSection += this.extractTextFromParagraph(paragraph) + '\n';
                    continue;
                }

                // Regular paragraph
                if (inList) {
                    currentSection += '\n';
                    inList = false;
                }

                currentSection += this.extractTextFromParagraph(paragraph) + '\n\n';
            }

            // Add the last section if not empty
            if (currentSection) {
                sections.push(currentSection.trim());
            }

            // If no sections were created (no level 1 headers), put all content in one section
            if (sections.length === 0 && currentSection) {
                sections.push(currentSection.trim());
            }

            return Expected.ok(sections);
        } catch (error) {
            return Expected.err(`Failed to read document: ${error}`);
        }
    }

    // Helper method to extract text with formatting from paragraph elements
    private extractTextFromParagraph(paragraph: any): string {
        let text = '';

        if (!paragraph.elements) return text;

        for (const element of paragraph.elements) {
            if (!element.textRun?.content) continue;

            let content = element.textRun.content;
            const textStyle = element.textRun.textStyle || {};

            // Handle links
            if (textStyle.link?.url) {
                text += `[${content.trim()}](${textStyle.link.url})`;
            }
            // Handle basic formatting
            else {
                if (textStyle.bold) content = `**${content.trim()}**`;
                if (textStyle.italic) content = `*${content.trim()}*`;
                text += content;
            }
        }

        return text.replace(/\n/g, ' ').trim();
    }
}