import { EventEmitter } from "events";
import WebSocket = require('ws'); // Измените эту строку


type ConfigType = {
  voiceId?: string;
  [key: string]: any;
};

class TextToSpeechServiceWEB extends EventEmitter {
  private config: ConfigType;
  private wsUrl: string;

  constructor(config: ConfigType) {
    super();
    this.config = config;
    this.config.voiceId ||= process.env.VOICE_ID!;
    const outputFormat = "pcm_16000";
    this.wsUrl = `wss://api.elevenlabs.io/v1/text-to-speech/${this.config.voiceId}/stream-input?model_id=${process.env.XI_MODEL_ID}&output_format=${outputFormat}`;
  }

  async generate(text: string): Promise<void> {
    const socket = new WebSocket(this.wsUrl);

    socket.onopen = () => {
      // Инициализация соединения
      const bosMessage = {
        text: " ",
        voice_settings: {
          stability: process.env.ELEVENLABS_STABILITY,
          similarity_boost: process.env.ELEVENLABS_SIMILARITY
        },
        generation_config: {
          chunk_length_schedule: [120, 160]
        },
        xi_api_key: process.env.XI_API_KEY!,
      };
      socket.send(JSON.stringify(bosMessage));

      // Отправка текста
      const textMessage = {
        text: text,
        try_trigger_generation: true,
      };
      socket.send(JSON.stringify(textMessage));

      // Отправка сообщения об окончании
      const eosMessage = { text: "" };
      socket.send(JSON.stringify(eosMessage));
    };

    socket.onmessage = (event: WebSocket.MessageEvent) => {
        const response = JSON.parse(event.data.toString());
        if (response.audio) {
          const audioBytes = Uint8Array.from(atob(response.audio), c => c.charCodeAt(0));
          
          this.emit("speech", Buffer.from(audioBytes).toString("base64"), text, false);
        }
  
        if (response.isFinal) {
          this.emit("finalChunk");
          socket.close();
        }
    };
    
    socket.onerror = (error: WebSocket.ErrorEvent) => {
      console.error(`WebSocket Error: ${error.message}`);
    };
    
    socket.onclose = (event: WebSocket.CloseEvent) => {
      if (!event.wasClean) {
        console.warn('Connection died');
      }
    };      
  }
}

export { TextToSpeechServiceWEB };
