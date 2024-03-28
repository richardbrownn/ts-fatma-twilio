import { WebSocket } from 'ws';

declare module 'express-serve-static-core' {
    interface Application {
        ws: (route: string, callback: (ws: WebSocket, req: express.Request) => void) => void;
    }
}
