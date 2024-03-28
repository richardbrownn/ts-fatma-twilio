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
    DEEPGRAM_DELAY: string;
    DEEPGRAM_MODEL: string;
    DEEPGRAM_APIKEY: string;
    ELEVENLABS_STABILITY: string;
    ELEVENLABS_SIMILARITYBOOST: string;
    PLAYHT_APIKEY: string;
    PLAYHT_USERID: string;
    PLAYHT_VOICE: string;
    OPENAI_MODEL: string;
    OPENAI_APIKEY: string;
    ELEVENLABS_MODEL: string;
    ELEVENLABS_VOICEID: string
    ELEVENLABS_APIKEY: string;
    SERVER_ADDRESS: string
    OPENAI_CONTEXT?: string;
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
        this.app.post('/update-welcome-message-8000', this.updateWelcomeMessage8000);
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
DEEPGRAM_API_KEY="${settings.DEEPGRAM_APIKEY}"
XI_API_KEY="${settings.ELEVENLABS_APIKEY}"
XI_MODEL_ID="${settings.ELEVENLABS_MODEL}"
VOICE_ID="${settings.ELEVENLABS_VOICEID}"
SERVER="${settings.SERVER_ADDRESS}"
OPENAI_API_KEY="${settings.OPENAI_APIKEY}"
DEEPGRAM_MODEL="${settings.DEEPGRAM_MODEL}"
DEEPGRAM_UTTERANCE="${settings.DEEPGRAM_DELAY}"
ELEVENLABS_STABILITY="${settings.ELEVENLABS_STABILITY}"
ELEVENLABS_SIMILARITY="${settings.ELEVENLABS_SIMILARITYBOOST}"
OPENAI_MODEL="${settings.OPENAI_MODEL}"
OPENAI_CONTEXT="${settings.OPENAI_CONTEXT || 'You are a universal assistant'}"
PLAYHT_API_KEY="${settings.PLAYHT_APIKEY}"
PLAYHT_VOICE="${settings.PLAYHT_VOICE}"
PLAYHT_USER_ID="${settings.PLAYHT_USERID}"`;


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
    
        // Authentication check
        const user = this.loadUsers().find(u => u.username === username && u.password === password);
        if (!user) {
            return res.status(401).send({ message: 'Unauthorized access' });
        }
    
        // Define the keys that can be updated
        const allowedKeys = new Set([
            "DEEPGRAM_DELAY", "DEEPGRAM_MODEL", "DEEPGRAM_APIKEY",
            "OPENAI_CONTEXT", "OPENAI_MODEL", "OPENAI_APIKEY",
            "SERVER_ADDRESS", "ELEVENLABS_STABILITY", "ELEVENLABS_SIMILARITYBOOST",
            "ELEVENLABS_MODEL", "ELEVENLABS_VOICEID", "ELEVENLABS_APIKEY",
            "PLAYHT_APIKEY", "PLAYHT_USERID", "PLAYHT_VOICE",
        ]);
    
        // Validate and sanitize the incoming settings
        const validatedSettings = Object.keys(settings).reduce((acc, key) => {
            if (allowedKeys.has(key)) {
                // Perform necessary sanitization for each setting based on its expected data type/format
                // For example, if a setting is expected to be a string, sanitize to remove any malicious code
                acc[key] = settings[key]; // Replace this with actual sanitization logic
            }
            return acc;
        }, {});
    
        // Update the settings
        const currentSettings = this.loadSettings();
        const newSettings = { ...currentSettings, ...validatedSettings };
        this.saveSettings(newSettings);
    
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
    
    private updateWelcomeMessage8000 = async (req: express.Request, res: express.Response) => {
        const { username, password, text } = req.body;
        const user = this.loadUsers().find(u => u.username === username && u.password === password);

        if (!user) {
            return res.status(401).send({ message: 'Unauthorized access' });
        }

        if (!text) {
            return res.status(400).send({ message: 'Text is required' });
        }
        const ttsService8000 = new TextToSpeechService({});
        let audioData: string[] = [];

        ttsService8000.generate(text);
        try {
            await new Promise<void>((resolve, reject) => {
                ttsService8000.on("speech", (audioBase64: string, label: string, isFinal: boolean) => {
                    audioData.push(audioBase64);
                });

                ttsService8000.on("finalChunk", () => {
                    resolve();
                });

                setTimeout(() => reject(new Error("Timeout waiting for final chunk")), 10000);
            });

            const audioBuffer = Buffer.concat(audioData.map(part => Buffer.from(part, 'base64')));
            const filePath = path.join(__dirname, '../welcome8000.wav');
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
