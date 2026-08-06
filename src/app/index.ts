import { ProtocolRegistry } from "#protocol/ProtocolRegistry.js";
import { AppLifecycle } from "#lifecycle/AppLifecycle.js";
import { MainWindow } from "#windows/MainWindow.js";
import "#ipc/controllers/index.js";

ProtocolRegistry.registerSchemes();
AppLifecycle.registerAppLifecycle(MainWindow.createMainWindow);
