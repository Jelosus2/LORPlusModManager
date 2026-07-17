import { SetupController } from "./SetupController.js";
import { IpcHelper } from "#ipc/IpcHelper.js";

IpcHelper.registerIpcController(new SetupController());
