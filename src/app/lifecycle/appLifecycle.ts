import { app, BrowserWindow, Menu } from "electron";

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
            if (app.isPackaged)
                Menu.setApplicationMenu(null);

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
