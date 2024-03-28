require('dotenv').config();
import * as PlayHT from 'playht';
import { EventEmitter } from 'events';



// Предполагаем, что PlayHT предоставляет типы для этих значений
// Пожалуйста, замените 'YourVoiceEngineValue' на действительное значение из SDK
type PlayHTConfigType = {
  apiKey: string;
  userId: string;
  voiceEngine: any; // Замените any на конкретный тип VoiceEngine, если он доступен
  voiceId: string;
  sampleRate: number;
  outputFormat: string;
  speed: number;
};

class TextToSpeechServicePlayHT extends EventEmitter {
  private config: PlayHTConfigType;
  private isFirstChunkSkipped: boolean; // Добавляем флаг для пропуска первого чанка

  constructor(config: PlayHTConfigType) {
    super();
    this.config = config;
    this.isFirstChunkSkipped = false; // Инициализируем флаг как false
    // Инициализация PlayHT
    PlayHT.init({
      apiKey: process.env.PLAYHT_API_KEY,
      userId: process.env.PLAYHT_USER_ID,
    });
  }

  async generate(text: string): Promise<void> {
    const streamingOptions = {
      voiceEngine: "PlayHT2.0-turbo",
      voiceId: "s3://voice-cloning-zero-shot/dc23bb38-f568-4323-b6fb-7d64f685b97a/joseph/manifest.json",
      sampleRate: 16000,
      outputFormat: 'wav', // Убедитесь, что формат 'raw' подходит для вашей задачи
      speed: 1,
    };

    try {
      const stream = await PlayHT.stream(text, streamingOptions);

      stream.on('data', (chunk) => {
        if (!this.isFirstChunkSkipped) {
          // Пропускаем первый чанк и обновляем флаг
          this.isFirstChunkSkipped = true;
          return; // Прекращаем выполнение функции, чтобы не обрабатывать первый чанк
        }
        // Преобразование chunk в base64
        const base64String = chunk.toString('base64');
        // Дальше с base64String можно делать все, что угодно
        this.emit('speech', base64String);
      });

      stream.on('end', () => {
        console.log("end");
        this.emit('finalChunk');
        this.isFirstChunkSkipped = false; // Сбрасываем флаг после завершения потока
      });
    } catch (error) {
      console.error(`Ошибка при генерации речи: ${error.message}`);
      this.emit('error', error);
      this.isFirstChunkSkipped = false; // Сбрасываем флаг в случае ошибки
    }
  }
}


export { TextToSpeechServicePlayHT };
