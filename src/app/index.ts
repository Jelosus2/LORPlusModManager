import { registerAppLifecycle } from "#lifecycle/appLifecycle.js";
import { createMainWindow } from "#windows/mainWindow.js";

registerAppLifecycle(createMainWindow);
