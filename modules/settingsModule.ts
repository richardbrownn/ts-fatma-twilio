import bodyParser = require('body-parser');;
import fs = require('fs');
import path = require('path');
import cors = require('cors');
import { TextToSpeechService } from "./tts-service";
import { TextToSpeechServiceWEB } from "./tts-service-web";
import express = require('express');
import https = require('https');


interface User {
    username: string;
    password: string;
}

interface Settings {
    delay: string;
    deepgramModel: string;
    stability: string;
    similarityBoost: string;
    openaiApiKey: string;
    xiModelId: string;
    voiceId: string
    xiApiKey: string;
    server: string;
    deepgramApiKey: string;
    openaiContext?: string;
}

export class SettingsModule {
    private app: express.Application;
    private httpsServer: https.Server;

    constructor(app: express.Application) {
        this.app = app;
        this.app.use(bodyParser.json());
        this.app.use(cors());
        this.setupRoutes();
        // Инициализация HTTPS сервера
        const privateKey = fs.readFileSync('/etc/letsencrypt/live/voice.roboticated.com//privkey.pem', 'utf8');
        const certificate = fs.readFileSync('/etc/letsencrypt/live/voice.roboticated.com//fullchain.pem', 'utf8');
        const credentials = { key: privateKey, cert: certificate };
        this.httpsServer = https.createServer(credentials, this.app);
    }

    private setupRoutes() {
        this.app.get('/settings', this.getSettings);
        this.app.post('/settings', this.postSettings);
        this.app.post('/login', this.login);
        this.app.post('/update-welcome-message', this.updateWelcomeMessage);
    }

    private loadUsers = (): User[] => {
        try {
            const filePath = path.join(__dirname, 'users.json');
            const fileData = fs.readFileSync(filePath);
            return JSON.parse(fileData.toString()) as User[];
        } catch (error) {
            console.error('Error reading users file:', error);
            return [];
        }
    };

    private loadSettings = (): Settings => {
        try {
            const filePath = path.join(__dirname, 'settings.json');
            const fileData = fs.readFileSync(filePath);
            return JSON.parse(fileData.toString()) as Settings;
        } catch (error) {
            console.error('Error reading settings file:', error);
            return {} as Settings;
        }
    };

    private saveSettings = (settings: Settings) => {
        try {
            const filePath = path.join(__dirname, 'settings.json');
            fs.writeFileSync(filePath, JSON.stringify(settings, null, 2));
            this.saveSettingsToEnv(settings);
        } catch (error) {
            console.error('Error writing settings file:', error);
        }
    };

    private saveSettingsToEnv = (settings: Settings) => {
        try {
            const envFilePath = path.join(__dirname, '../.env');
            const envContent = `
DEEPGRAM_API_KEY="${settings.deepgramApiKey}"
XI_API_KEY="${settings.xiApiKey}"
XI_MODEL_ID="${settings.xiModelId}"
VOICE_ID="${settings.voiceId}"
SERVER="${settings.server}"
OPENAI_API_KEY="${settings.openaiApiKey}"
DEEPGRAM_MODEL="${settings.deepgramModel}"
DEEPGRAM_UTTERANCE=${settings.delay}
ELEVENLABS_STABILITY=${settings.stability}
ELEVENLABS_SIMILARITY=${settings.similarityBoost}
OPENAI_MODEL="gpt-3.5-turbo-1106"
OPENAI_CONTEXT="${settings.openaiContext || 'You are a universal assistant'}"
PLAYHT_API_KEY="e3652dd0cda640bba2cf56d6b8507e12"
PLAYHT_USER_ID="VNV7WBf53wWVmGUhpv9pijv9H9k1"`;


            fs.writeFileSync(envFilePath, envContent);
            console.log('Settings written to .env file successfully');
        } catch (error) {
            console.error('Error writing to .env file:', error);
        }
    };

    private getSettings = (req: express.Request, res: express.Response) => {
        const settings = this.loadSettings();
        res.send(settings);
    };

    private postSettings = (req: express.Request, res: express.Response) => {
        const { username, password, settings } = req.body;

        const user = this.loadUsers().find(u => u.username === username && u.password === password);

        if (!user) {
            return res.status(401).send({ message: 'Unauthorized access' });
        }

        this.saveSettings(settings as Settings);
        res.send({ message: 'Settings updated successfully' });
    };

    private login = (req: express.Request, res: express.Response) => {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).send('Username and password are required');
        }

        const users = this.loadUsers();
        const user = users.find(u => u.username === username && u.password === password);

        if (user) {
            res.status(200).send({ message: 'Login successful' });
        } else {
            res.status(401).send({ message: 'Invalid username or password' });
        }
    };

    private updateWelcomeMessage = async (req: express.Request, res: express.Response) => {
        const { username, password, text } = req.body;
        const user = this.loadUsers().find(u => u.username === username && u.password === password);

        if (!user) {
            return res.status(401).send({ message: 'Unauthorized access' });
        }

        if (!text) {
            return res.status(400).send({ message: 'Text is required' });
        }

        const ttsService16000 = new TextToSpeechServiceWEB({});
        let audioData: string[] = [];

        ttsService16000.generate(text);
        try {
            await new Promise<void>((resolve, reject) => {
                ttsService16000.on("speech", (audioBase64: string, label: string, isFinal: boolean) => {
                    audioData.push(audioBase64);
                });

                ttsService16000.on("finalChunk", () => {
                    resolve();
                });

                setTimeout(() => reject(new Error("Timeout waiting for final chunk")), 10000);
            });

            const audioBuffer = Buffer.concat(audioData.map(part => Buffer.from(part, 'base64')));
            const filePath = path.join(__dirname, '../welcome16000.wav');
            fs.writeFileSync(filePath, audioBuffer);
            res.send({ message: 'Welcome message updated successfully' });
        } catch (error) {
            console.error(`Error: ${error}`);
            res.status(500).send({ message: 'Error processing text-to-speech' });
        }


        const settings = this.loadSettings();
        this.saveSettingsToEnv(settings);

    };
    public start(port: number): void {
        this.httpsServer.listen(port, () => {
            console.log(`Settings server running on HTTPS port ${port}`);
        });
    }
}
