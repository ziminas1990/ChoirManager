import { v2 } from '@google-cloud/translate';

export class GoogleTranslate {

    private static api: v2.Translate | undefined;

    public static init(key_file: string): void {
        this.api = new v2.Translate({
            keyFilename: key_file
        });
    }

    public static async translate(text: string, target_language: string): Promise<string> {
        if (!this.api) {
            throw new Error('Google Translate API not initialized');
        }

        const [translation] = await this.api.translate(text, target_language);
        return translation;
    }
}