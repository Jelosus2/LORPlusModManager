import { app, BrowserWindow } from "electron";
import { Paths } from "#utils/Paths.js";

export class MainWindow {
    static async createMainWindow(): Promise<BrowserWindow> {
        const mainWindow = new BrowserWindow({
            title: "LORPlusModManager",
            //icon: getAppIconPath(),
            autoHideMenuBar: true,
            width: 1400,
            height: 768,
            //backgroundColor: ,
            //frame: false,
            show: false,
            webPreferences: {
                preload: Paths.getPreloadPath(),
                contextIsolation: true,
                nodeIntegration: false,
                devTools: !app.isPackaged
            }
        });

        if (app.isPackaged)
        {
            mainWindow.webContents.on("devtools-opened", () => {
                mainWindow.webContents.closeDevTools();
            });
        }

        mainWindow.once("ready-to-show", () => {
            if (!mainWindow.isMaximized())
                mainWindow.maximize();

            mainWindow.show();
        });

        mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

        mainWindow.on("close", async (event) => {
            event.preventDefault();
            mainWindow.close();
        });

        if (app.isPackaged)
            await mainWindow.loadFile(Paths.getRendererHtmlPath());
        else
            await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL ?? "http://localhost:5173/");

        return mainWindow;
    }
}
