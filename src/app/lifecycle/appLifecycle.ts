import { app, BrowserWindow, Menu } from "electron";

export type WindowFactory = () => Promise<BrowserWindow>;

let mainWindow: BrowserWindow | null = null;

export function registerAppLifecycle(createMainWindow: WindowFactory) {
    const hasSingleInstanceLock = app.requestSingleInstanceLock();
    if (!hasSingleInstanceLock) {
        app.quit();
        return;
    }

    app.on("second-instance", () => {
        showMainWindow();
    });

    app.whenReady().then(async () => {
        if (app.isPackaged)
            Menu.setApplicationMenu(null);

        mainWindow = await createMainWindow();

        app.on("activate", async () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                mainWindow = await createMainWindow();
                return;
            }

            showMainWindow();
        });
    });

    app.on("window-all-closed", () => {
        app.quit();
    });
}

function showMainWindow() {
    const window = mainWindow ?? BrowserWindow.getAllWindows()[0];

    if (!window || window.isDestroyed())
        return;

    if (window.isMinimized())
        window.restore();

    window.show();
}
