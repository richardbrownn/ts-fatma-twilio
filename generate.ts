import * as dotenv from "dotenv";
dotenv.config();
import * as fs from 'fs';
import { TextToSpeechService } from './modules/tts-service';
import * as readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('Введите текст для синтеза речи: ', (text: string) => {
  rl.question('Введите имя файла для сохранения (без расширения): ', (filename: string) => {
    const ttsService = new TextToSpeechService({});

    let audioData: string[] = [];
    ttsService.generate(text);

    ttsService.on("speech", (audioBase64: string, label: string, isFinal: boolean) => {
      audioData.push(audioBase64);
    });

    ttsService.on("finalChunk", () => {
      const audioBuffer = Buffer.concat(audioData.map(part => Buffer.from(part, 'base64')));
      fs.writeFileSync(`${filename}.wav`, audioBuffer);
      console.log(`Аудио записано в файл: ${filename}.wav`);
      rl.close(); // Закрытие readline после завершения всех операций
    });
  });
});
