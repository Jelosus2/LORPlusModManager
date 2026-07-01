import { getPreloadPath, getRendererHtmlPath } from "#paths.js";
import { app, BrowserWindow } from "electron";

export async function createMainWindow() {
    const mainWindow = new BrowserWindow({
        title: "LORPlusModManager",
        //icon: getAppIconPath(),
        autoHideMenuBar: true,
        width: 1275,
        height: 660,
        //backgroundColor: ,
        resizable: false,
        maximizable: false,
        fullscreenable: false,
        //frame: false,
        show: false,
        webPreferences: {
            preload: getPreloadPath(),
            contextIsolation: true,
            nodeIntegration: false,
            devTools: !app.isPackaged
        }
    });

    if (app.isPackaged) {
        mainWindow.webContents.on("devtools-opened", () => {
            mainWindow.webContents.closeDevTools();
        });
    }

    mainWindow.once("ready-to-show", () => {
        mainWindow.show();
    });

    mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

    mainWindow.on("close", async (event) => {
        event.preventDefault();
        mainWindow.close();
    });

    if (app.isPackaged)
        await mainWindow.loadFile(getRendererHtmlPath());
    else
        await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL ?? "http://localhost:5173/");

    return mainWindow;
}
