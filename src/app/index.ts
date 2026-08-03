import { CatalogIconProtocol } from "#protocol/CatalogIconProtocol.js";
import { AppLifecycle } from "#lifecycle/AppLifecycle.js";
import { MainWindow } from "#windows/MainWindow.js";
import "#ipc/controllers/index.js";

CatalogIconProtocol.registerScheme();
AppLifecycle.registerAppLifecycle(MainWindow.createMainWindow);
