import { EventEmitter } from 'events';
import fetch from 'node-fetch';
import { io } from "socket.io-client";

class ChatGPTStreamServiceNEW extends EventEmitter {
    private socket: ReturnType<typeof io>;
    private httpUrl: string;
    private threadId?: string;
    private isStreamingActive: boolean;
    private textBuffer: string = ''; // Буфер для накопления текста

    constructor(httpUrl: string = 'http://127.0.0.1:8080/start') {
        super();
        this.httpUrl = httpUrl;
        this.isStreamingActive = false;
    }

    async init(): Promise<void> {
        const response = await fetch(this.httpUrl);
        const data = await response.json();
        this.threadId = data.thread_id;

        if (!this.threadId) {
            throw new Error("Failed to get thread_id");
        }

        this.socket = io('http://127.0.0.1:8080', {
            path: '/socket.io/',
            transports: ['websocket'],
        });

        this.socket.on('connect', () => {
            console.log('Connected to the server.');
        });

        this.socket.on('assistant_message', (data: any) => {
            console.log(data);
            if (this.isStreamingActive && data.text) {
                this.textBuffer += data.text; // Добавляем текст в буфер
                if (this.isCompleteChunk(this.textBuffer)) { // Проверяем, готов ли чанк
                    this.emit('message', this.textBuffer, false);
                    this.textBuffer = ''; // Очищаем буфер после отправки
                }
            }
        });

        this.socket.on('stream_end', (data: any) => {
            this.isStreamingActive = false;
            this.emit('message', '', true);
            this.textBuffer = '';
        });
    }

    private isCompleteChunk(text: string): boolean {
        // Функция проверки завершенности чанка по знакам препинания
        return /[.,?!:;]/.test(text);
    }

    streamResponse(instructions: string): void {
        this.isStreamingActive = true;
        if (!this.threadId) {
            throw new Error("Failed to get thread_id");
        }
        this.socket.emit('start_stream', { thread_id: this.threadId, instructions: instructions });
    }

    close(): void {
        this.socket.close();
    }

    abortStreaming(): void {
        this.isStreamingActive = false;
    }
}

export { ChatGPTStreamServiceNEW };
