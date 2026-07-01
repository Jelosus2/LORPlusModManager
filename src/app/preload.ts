import { contextBridge, ipcRenderer } from "electron";

const modManagerApi = {

} as const;

contextBridge.exposeInMainWorld("app", modManagerApi);
