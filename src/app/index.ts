import { AppLifecycle } from "#lifecycle/AppLifecycle.js";
import { MainWindow } from "#windows/MainWindow.js";
import "#ipc/controllers/index.js";

AppLifecycle.registerAppLifecycle(MainWindow.createMainWindow);
