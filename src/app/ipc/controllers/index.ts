import { CharacterController } from "./CharacterController.js";
import { PluginController } from "./PluginController.js";
import { SetupController } from "./SetupController.js";
import { IpcHelper } from "#ipc/IpcHelper.js";

IpcHelper.registerIpcController(new SetupController());
IpcHelper.registerIpcController(new PluginController());
IpcHelper.registerIpcController(new CharacterController());
