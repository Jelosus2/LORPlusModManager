/// <reference types="vite/client" />
import type { IpcApi } from "./src/shared/ipcApi";

declare global {
    interface Window {
        app: IpcApi;
    }
}

export {};
