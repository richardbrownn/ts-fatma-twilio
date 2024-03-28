require("dotenv").config();
const express = require("express");
const https = require('https');
const ExpressWs = require("express-ws");
const fs = require('fs');
const WS = require('ws'); // Измените имя переменной здесь
const cors = require('cors');

const { TextToSpeechService } = require("./modules/tts-service");
const { TranscriptionService } = require("./modules/transcription-service");
const { TranscriptionServiceWEB } = require("./modules/transcription-service-web");
const { TextToSpeechServiceWEB } = require("./modules/tts-service-web");
const { ChatGPTStreamService } = require("./modules/chatgpt-service");
//const { TextToSpeechServicePlayHT } = require("./modules/tts-service-playht");
const { SettingsModule } = require('./modules/settingsModule');
const { ChatGPTStreamServiceNEW } = require('./modules/chatgpt-service-assistants')

const httpsOptions = {
    cert: fs.readFileSync('/etc/letsencrypt/live/voice.roboticated.com/fullchain.pem'),
    key: fs.readFileSync('/etc/letsencrypt/live/voice.roboticated.com/privkey.pem')
  };


const app = express();
app.use(cors());
const server = https.createServer(httpsOptions, app);
const sessions = new Map();
ExpressWs(app, server);

const PORT = 3001;


let isRequestProcessing: boolean = false;
let chunkCount: number = 0;
let markCount: number = 0;
let chunkCheckTimer: NodeJS.Timeout | undefined;

const welcomeAudio8000: Buffer = fs.readFileSync('./welcome8000.wav');
const welcomeAudio16000: Buffer = fs.readFileSync('./welcome16000.wav');
const welcomeAudio8000Base64: string = welcomeAudio8000.toString('base64');
const welcomeAudio16000Base64: string = welcomeAudio16000.toString('base64');
const context = process.env.OPENAI_CONTEXT;

app.post("/incoming", (req, res) => {
    res.status(200);
    res.type("text/xml");
    res.end(`
    <Response>
        <Connect>
        <Stream url="wss://${process.env.SERVER}/connection" />
        </Connect>
    </Response>
    `);
});



app.ws("/connection", (ws, req) => {
    ws.on("error", console.error);
    let streamSid: string;

    const transcriptionService = new TranscriptionService();
    const ttsService = new TextToSpeechService({});
    const chatGPTService = new ChatGPTStreamService();
    let lastTranscriptionTime: number = Date.now();
    let accumulatedTranscription: string = "";
    let messageHistory: { role: string, content: string }[] = [];
    let transcriptionTimer: NodeJS.Timeout;
    let silenceTimer: NodeJS.Timeout;
    let repeatQuestionTimer: NodeJS.Timeout;
    let isChatGPTStreaming: boolean = false;
    let isAudioStreaming: boolean = false;
    let isTTSGenerting: boolean = false;
    let chatGPTQueue: { response: string, status: boolean }[] = [];
    let isWelcomeAudioPlaying: boolean = false;
    let awaitingFinalTranscription: boolean = false;
    let accumulatedResponse: string = ""; 

    messageHistory.push({ role: "system", content: context });

    ws.on("message", function message(data: string) {
        const msg = JSON.parse(data);
        if (msg.event === "start") {
            streamSid = msg.start.streamSid;
            console.log(`Starting Media Stream for ${streamSid}`);
            setTimeout(() => {
                isWelcomeAudioPlaying = true;
                ws.send(JSON.stringify({
                    streamSid,
                    event: "media",
                    media: {
                        payload: welcomeAudio8000Base64
                    }
                }));
                ws.send(JSON.stringify({
                    streamSid,
                    event: "mark",
                    mark: {
                        name: 'welcome_audio_end'
                    }
                }));
            }, 1000);
            initiateSilenceKiller();
        } else if (msg.event === "media" && !isWelcomeAudioPlaying) {
            transcriptionService.send(msg.media.payload);
        } else if (msg.event === "mark" && !isWelcomeAudioPlaying && msg.mark.name != 'welcome_audio_end') {
            markCount++;
            if (!chunkCheckTimer) {
                if (chunkCount === markCount) {
                    isRequestProcessing = false;
                    isAudioStreaming = false;
                    console.log("All chunks processed.");
                }
            }
            resetKiller();
            console.log(`Media completed mark (${msg.sequenceNumber}): ${msg.mark.name}`)
        } else if (msg.event === "mark" && isWelcomeAudioPlaying && msg.mark.name === 'welcome_audio_end') {
            isWelcomeAudioPlaying = false;
        }
    });

    const processChatGPTQueue = async () => {
        while (chatGPTQueue.length > 0 && !isTTSGenerting) {
            try {
                const { response, status } = chatGPTQueue.shift()!;
                console.log(`Status :${status}`);
                if (status) {
                    isChatGPTStreaming = false;
                } else {
                    if (isChatGPTStreaming) {
                        console.log(`Received response from ChatGPT: ${response}`);
                        accumulatedResponse += response + " ";
                        isTTSGenerting = true;
                        isAudioStreaming = true;
                        accumulatedTranscription = "";
                        await ttsService.generate(response);
                    } else {
                        return;
                    }
                }
            } catch (error) {
                console.error("Error processing ChatGPT Queue:", error);
                abortStreamingAndAudio();
            }
        }
    };

    const clearAudioStream = () => {
        ws.send(JSON.stringify({
            event: "clear",
            streamSid: streamSid
        }));
    };

    const initiateSilenceKiller = () => {
        repeatQuestionTimer = setTimeout(closeConnection, 16000);
    };

    const sendToGPT = () => {
        try {
            clearTimeout(transcriptionTimer);
    
            // Добавляем новое сообщение от пользователя в историю сообщений
            messageHistory.push({ role: "user", content: accumulatedTranscription.trim() });
    
            console.log(`Sending accumulated transcription to ChatGPT: ${accumulatedTranscription}`);
            isRequestProcessing = true;
            chunkCount = 0;
            markCount = 0;
    
            // Отправляем историю сообщений в сервис ChatGPT
            console.log(messageHistory);
            chatGPTService.streamResponse(messageHistory);
    
            isChatGPTStreaming = true;
        } catch (error) {
            console.error("Error in sendToGPT function:", error);
            abortStreamingAndAudio();
        }
    };
    

    const resetKiller = () => {
        clearTimeout(repeatQuestionTimer);
        repeatQuestionTimer = setTimeout(closeConnection, 30000);
    };

    const closeConnection = () => {
        if (Date.now() - lastTranscriptionTime >= 30000 && !isRequestProcessing) {
            ws.close();
        }
    };

    transcriptionService.on("transcription", (text, isFinal, isEnd) => {
        console.log(`Received transcription: ${text}`);
        if (accumulatedResponse.length > 0){
            messageHistory.push({ role: "system", content: accumulatedResponse});
            console.log(messageHistory);
            accumulatedResponse = "";
        }
        if (isRequestProcessing && isAudioStreaming && !isFinal) {
            awaitingFinalTranscription = true;
            abortStreamingAndAudio();
            return;
        }
        if (isRequestProcessing && isAudioStreaming && isFinal) {
            abortStreamingAndAudio();
            return;
        }
        if (isRequestProcessing && !isAudioStreaming) {
            abortStreamingAndAudio();
        }
        if (awaitingFinalTranscription && !isFinal) {
            return;
        }
        if (isFinal && awaitingFinalTranscription) {
            awaitingFinalTranscription = false;
            return;
        }
        if (isFinal) {
            accumulatedTranscription += " " + text;
        }
        if (isEnd && accumulatedTranscription.length > 0) {
            sendToGPT();
        }
        lastTranscriptionTime = Date.now();
    });

    transcriptionService.on("error", (error) => {
        console.error(`Transcription service error: ${error}`);
    });

    chatGPTService.on("message", (response, status) => {
        chatGPTQueue.push({ response, status });
        if (!isTTSGenerting && isChatGPTStreaming) {
            processChatGPTQueue();
        }
    });

    ttsService.on("speech", (audio, label) => {
        if (isTTSGenerting) {
            chunkCount++;
            clearTimeout(chunkCheckTimer);
            chunkCheckTimer = setTimeout(() => {
                chunkCheckTimer = null;
                if (chunkCount === markCount) {
                    isRequestProcessing = false;
                    isAudioStreaming = false;
                    console.log("All chunks processed.");
                }
            }, 500);
            console.log(`Sending audio to Twilio ${audio.length} b64 characters`);
            
            ws.send(JSON.stringify({
                streamSid,
                event: "media",
                media: {
                    payload: audio,
                },
            }));
            ws.send(JSON.stringify({
                streamSid,
                event: "mark",
                mark: {
                    name: label
                }
            }));
        }
    });

    ttsService.on("finalChunk", () => {
        isTTSGenerting = false;
        console.log("final");
        if (isChatGPTStreaming) {
            processChatGPTQueue();
        }
    });

    const abortStreamingAndAudio = () => {
        clearTimeout(silenceTimer);
        console.log("Aborting streaming and stopping audio.");
        chatGPTService.abortStreaming();
        isChatGPTStreaming = false;
        isTTSGenerting = false;
        isRequestProcessing = false;
        isAudioStreaming = false;
        clearAudioStream();
        chatGPTQueue = []
    
        // Удаление двух последних элементов из messageHistory, если в списке есть хотя бы два элемента
        if (messageHistory.length > 2) {
            messageHistory.splice(-2);
        } else {
            // Если элементов меньше двух, то полностью очищаем массив
            messageHistory = [];
            messageHistory.push({ role: "system", content: context });
        }
    };    
});
app.ws("/web", (ws, req) => {
    ws.on("error", console.error);
    let streamSid: string;
    console.log("1");
    const sessionId = generateUniqueSessionId(); // Генерируем уникальный ID для новой сессии
    console.log("1.1");
    const session = {
        ws: ws,
        streamSid: '',
        thread: '',
        transcriptionService: new TranscriptionServiceWEB(),
        ttsService: new TextToSpeechServiceWEB({}),
        chatGPTService:  new ChatGPTStreamService(),
        lastTranscriptionTime: Date.now(),
        accumulatedTranscription: "",
        messageHistory: [],
        transcriptionTimer: 0,
        silenceTimer: 0,
        chunkCheckTimer: 0,
        repeatQuestionTimer: 0,
        isRequestProcessing: false,
        isChatGPTStreaming: false,
        isAudioStreaming: false,
        isTTSGenerting: false,
        chatGPTQueue: [],
        isWelcomeAudioPlaying: false,
        awaitingFinalTranscription: false,
        accumulatedResponse: "",
        markCount: 0,
        chunkCount: 0
    };
    console.log("2");
    // Сохраняем сессию в хранилище
    sessions.set(sessionId, session);
    console.log("4");

    session.ws.on("message", function message(data: string) {
        const msg = JSON.parse(data);
        if (msg.event === "start") {
            streamSid = msg.start.streamSid;
            console.log(`Starting Media Stream for ${streamSid}`);
            setTimeout(() => {
                session.isWelcomeAudioPlaying = true;
                ws.send(JSON.stringify({
                    streamSid,
                    event: "media",
                    media: {
                        payload: welcomeAudio16000Base64
                    }
                }));
                ws.send(JSON.stringify({
                    streamSid,
                    event: "mark",
                    mark: {
                        name: 'welcome_audio_end'
                    }
                }));
            }, 1000);
            initiateSilenceKiller();
        } else if (msg.event === "media" && !session.isWelcomeAudioPlaying) {
            session.transcriptionService.send(msg.media.payload);
        } else if (msg.event === "mark" && !session.isWelcomeAudioPlaying && msg.mark.name != 'welcome_audio_end') {
            session.markCount++;
            if (!session.chunkCheckTimer) {
                if (chunkCount === markCount) {
                    session.isRequestProcessing = false;
                    session.isAudioStreaming = false;
                    console.log("All chunks processed.");
                }
            }
            resetKiller();
            console.log(`Media completed mark (${msg.sequenceNumber}): ${msg.mark.name}`)
        } else if (msg.event === "mark" && session.isWelcomeAudioPlaying && msg.mark.name === 'welcome_audio_end') {
            session.isWelcomeAudioPlaying = false;
        }
    });

    const processChatGPTQueue = async () => {
        while (session.chatGPTQueue.length > 0 && !session.isTTSGenerting) {
            try {
                const { response, status } = session.chatGPTQueue.shift()!;
                console.log(`Status :${status}`);
                if (status) {
                    session.isChatGPTStreaming = false;
                } else {
                    if (session.isChatGPTStreaming) {
                        console.log(`Received response from ChatGPT: ${response}`);
                        session.accumulatedResponse += response + " ";
                        session.isTTSGenerting = true;
                        session.isAudioStreaming = true;
                        session.accumulatedTranscription = "";
                        await session.ttsService.generate(response);
                    } else {
                        return;
                    }
                }
            } catch (error) {
                console.error("Error processing ChatGPT Queue:", error);
                abortStreamingAndAudio();
            }
        }
    };

    const clearAudioStream = () => {
        session.ws.send(JSON.stringify({
            event: "clear",
            streamSid: streamSid
        }));
    };

    const initiateSilenceKiller = () => {
        session.repeatQuestionTimer = setTimeout(closeConnection, 16000);
    };

    const sendToGPT = () => {
        try {
            clearTimeout(session.transcriptionTimer);
    
            // Добавляем новое сообщение от пользователя в историю сообщений
            session.messageHistory.push({ role: "user", content: session.accumulatedTranscription.trim() });
    
            console.log(`Sending accumulated transcription to ChatGPT: ${session.accumulatedTranscription}`);
            session.isRequestProcessing = true;
            session.chunkCount = 0;
            session.markCount = 0;
            session.chatGPTService.streamResponse(session.messageHistory.trim());
    
            session.isChatGPTStreaming = true;
        } catch (error) {
            console.error("Error in sendToGPT function:", error);
            abortStreamingAndAudio();
        }
    };
    

    const resetKiller = () => {
        clearTimeout(session.repeatQuestionTimer);
        session.repeatQuestionTimer = setTimeout(closeConnection, 30000);
    };

    const closeConnection = () => {
        if (Date.now() - session.lastTranscriptionTime >= 30000 && !session.isRequestProcessing) {
            ws.close();
        }
    };

    session.transcriptionService.on("transcription", (text, isFinal, isEnd) => {
        console.log(`Received transcription: ${text}`);
        if (session.accumulatedResponse.length > 0){
            session.messageHistory.push({ role: "system", content: session.accumulatedResponse});
            console.log(session.messageHistory);
            session.accumulatedResponse = "";
        }
        if (session.isRequestProcessing && session.isAudioStreaming && !isFinal) {
            session.awaitingFinalTranscription = true;
            abortStreamingAndAudio();
            return;
        }
        if (session.isRequestProcessing && session.isAudioStreaming && isFinal) {
            abortStreamingAndAudio();
            return;
        }
        if (session.isRequestProcessing && !session.isAudioStreaming) {
            abortStreamingAndAudio();
        }
        if (session.awaitingFinalTranscription && !isFinal) {
            return;
        }
        if (isFinal && session.awaitingFinalTranscription) {
            session.awaitingFinalTranscription = false;
            return;
        }
        if (isFinal) {
            session.accumulatedTranscription += " " + text;
        }
        if (isEnd && session.accumulatedTranscription.length > 0) {
            sendToGPT();
        }
        session.lastTranscriptionTime = Date.now();
    });

    session.transcriptionService.on("error", (error) => {
        console.error(`Transcription service error: ${error}`);
    });

    session.chatGPTService.on("message", (response, status) => {
        console.log(response);
        console.log(status);
        session.chatGPTQueue.push({ response, status });
        if (!session.isTTSGenerting && session.isChatGPTStreaming) {
            processChatGPTQueue();
        }
    });

    session.ttsService.on("speech", (audio, label) => {
        if (session.isTTSGenerting) {
            chunkCount++;
            clearTimeout(session.chunkCheckTimer);
            session.chunkCheckTimer = setTimeout(() => {
                session.chunkCheckTimer = 0;
                if (session.chunkCount === session.markCount) {
                    session.isRequestProcessing = false;
                    session.isAudioStreaming = false;
                    console.log("All chunks processed.");
                }
            }, 500);
            console.log(`Sending audio to Twilio ${audio.length} b64 characters`);
            
            ws.send(JSON.stringify({
                streamSid,
                event: "media",
                media: {
                    payload: audio,
                },
            }));
            ws.send(JSON.stringify({
                streamSid,
                event: "mark",
                mark: {
                    name: label
                }
            }));
        }
    });

    session.ttsService.on("finalChunk", () => {
        session.isTTSGenerting = false;
        console.log("final");
        if (session.isChatGPTStreaming) {
            processChatGPTQueue();
        }
    });

    const abortStreamingAndAudio = () => {
        clearTimeout(session.silenceTimer);
        console.log("Aborting streaming and stopping audio.");
        console.log(session.isChatGPTStreaming,session.isTTSGenerting,session.isRequestProcessing,session.isAudioStreaming )
        session.chatGPTService.abortStreaming();
        session.isChatGPTStreaming = false;
        session.isTTSGenerting = false;
        session.isRequestProcessing = false;
        session.isAudioStreaming = false;
        clearAudioStream();
        session.chatGPTQueue = []
    
        // Удаление двух последних элементов из messageHistory, если в списке есть хотя бы два элемента
        if (session.messageHistory.length > 2) {
            session.messageHistory.splice(-2);
        } else {
            // Если элементов меньше двух, то полностью очищаем массив
            session.messageHistory = [];
            session.messageHistory.push({ role: "system", content: context });
        }
    };    
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`HTTPS server running on port ${PORT}`);
});
// Запуск сервера модуля settings
const settingsApp = express();
const settingsModule = new SettingsModule(settingsApp);
settingsModule.start(5500);
console.log(`Server running on port ${PORT}`);

