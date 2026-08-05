import { ApplicationLogger } from "#maintenance/ApplicationLogger.js";
import { ApplicationLogSource } from "../../shared/application.js";
import { AppDatabase } from "#database/AppDatabase.js";
import { app, BrowserWindow, Menu } from "electron";
import os from "node:os";

export type WindowFactory = () => Promise<BrowserWindow>;

export class AppLifecycle {
    private static mainWindow: BrowserWindow | null = null;

    static registerAppLifecycle(createMainWindow: WindowFactory) {
        const hasSingleInstanceLock = app.requestSingleInstanceLock();
        if (!hasSingleInstanceLock)
        {
            app.quit();
            return;
        }

        app.on("second-instance", () => {
            AppLifecycle.showMainWindow();
        });

        app.whenReady().then(async () => {
            app.setAppUserModelId("com.jelosus1.lorplusmodmanager");

            if (app.isPackaged)
                Menu.setApplicationMenu(null);

            await ApplicationLogger.initialize();

            ApplicationLogger.info(ApplicationLogSource.application, `Starting ${app.getName()} ${app.getVersion()}.`);
            ApplicationLogger.info(ApplicationLogSource.environment, "Runtime environment detected.", {
                "Node.js": process.versions.node,
                "Electron": process.versions.electron,
                "Windows": os.version(),
                "Windows kernel": os.release(),
                "Architecture": process.arch
            });

            AppDatabase.initialize();
            AppLifecycle.mainWindow = await createMainWindow();

            app.on("activate", async () => {
                if (BrowserWindow.getAllWindows().length === 0)
                {
                    AppLifecycle.mainWindow = await createMainWindow();
                    return;
                }

                AppLifecycle.showMainWindow();
            });
        });

        app.on("window-all-closed", () => {
            app.quit();
        });

        app.on("before-quit", () => {
            AppDatabase.close();
        });
    }

    private static showMainWindow() {
        const window = AppLifecycle.mainWindow ?? BrowserWindow.getAllWindows()[0];

        if (!window || window.isDestroyed())
            return;

        if (window.isMinimized())
            window.restore();

        window.show();
    }
}
