const { Deepgram } = require("@deepgram/sdk");
const { EventEmitter } = require("events");

class TranscriptionService extends EventEmitter {
  private deepgramLive: any; // Замените any на конкретный тип, если он доступен в @types/deepgram__sdk
  private lastTranscript: string | null = null;

  constructor() {
    super();
    const deepgram = new Deepgram(process.env.DEEPGRAM_API_KEY!);
    this.deepgramLive = deepgram.transcription.live({
      encoding: "mulaw",
      sample_rate: 8000,
      model: process.env.DEEPGRAM_MODEL,
      punctuate: true,
      interim_results: true,
      is_final: true,
      utterance_end_ms: process.env.DEEPGRAM_UTTERANCE,
    });

    this.deepgramLive.addListener("transcriptReceived", (transcriptionMessage: string) => {
      const transcription = JSON.parse(transcriptionMessage);
      if (transcription.type === 'UtteranceEnd') {
        console.log("UtteranceEnd без speech_final: отправка последнего результата");
        this.emit("transcription", this.lastTranscript, false, true);
      } else {
        const isFinal: boolean = transcription.is_final;
        const text: string | undefined = transcription.channel?.alternatives[0]?.transcript;
        
        if (text) {
          if (isFinal) {
            console.log("Полный результат: " + text);
            this.emit("transcription", text, true, false);
          } else {
            console.log("Предварительный результат: " + text);
            this.emit("transcription", text, false, false);
          }
          if (!isFinal) {
            this.lastTranscript = text;
          }
        }
      }
    });

    this.deepgramLive.addListener("error", (error: any) => {
      console.error("deepgram error");
      console.error(error);
    });

    this.deepgramLive.addListener("close", () => {
      console.log("Deepgram connection closed");
    });
  }

  send(payload: string): void {
    if (this.deepgramLive.getReadyState() === 1) {
      this.deepgramLive.send(Buffer.from(payload, "base64"));
    }
  }
}

export { TranscriptionService };
