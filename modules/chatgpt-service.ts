import { EventEmitter } from 'events';
const OpenAI = require('openai').default; // Если нет типов для OpenAI, используйте require

class ChatGPTStreamService extends EventEmitter {
    private openai: any; // Замените any на конкретный тип, если он доступен
    private isStreamingActive: boolean;
    private timeoutId?: NodeJS.Timeout; // NodeJS.Timeout для timeoutId

    constructor() {
        super();
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error("OpenAI API key is not set in environment variables.");
        }
        this.openai = new OpenAI({ apiKey: apiKey });
        this.isStreamingActive = false;
    }

    async streamResponse(messages: any[]): Promise<void> { // Замените any[] на более конкретный тип, если он известен
        try {
            this.isStreamingActive = true;
            this.timeoutId = undefined; // Используйте undefined для обнуления timeoutId
            const stream = await this.openai.chat.completions.create({
                model:  process.env.OPENAI_MODEL,
                messages: messages,
                stream: true,
            });

            let accumulatedContent = "";
            for await (const chunk of stream) {
                if (!this.isStreamingActive) break;

                const content = chunk.choices[0]?.delta?.content || "";
                accumulatedContent += content;

                if (/[.,?!:;]\s*$/.test(accumulatedContent)) {
                    if (this.timeoutId) {
                        clearTimeout(this.timeoutId);
                    }
                    this.emit("message", accumulatedContent, false);
                    accumulatedContent = "";
                }
            }
        } catch (error: any) { // Замените any на более конкретный тип ошибки, если он известен
            if (error.name !== 'AbortError') {
                this.emit("error", error);
            }
        } finally {
            this.isStreamingActive = false;
            this.emit("message", "", true);
            if (this.timeoutId) {
                clearTimeout(this.timeoutId); // Очищаем таймер при выходе
            }
        }
    }

    abortStreaming(): void {
        this.isStreamingActive = false;
    }
}

export { ChatGPTStreamService };