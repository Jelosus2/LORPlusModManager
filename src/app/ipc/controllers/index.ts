import { CharacterController } from "./CharacterController.js";
import { UpdateController } from "./UpdateController.js";
import { PluginController } from "./PluginController.js";
import { SetupController } from "./SetupController.js";
import { GameController } from "./GameController.js";
import { ModController } from "./ModController.js";
import { AppController } from "./AppController.js";
import { IpcHelper } from "#ipc/IpcHelper.js";

IpcHelper.registerIpcController(new SetupController());
IpcHelper.registerIpcController(new PluginController());
IpcHelper.registerIpcController(new CharacterController());
IpcHelper.registerIpcController(new ModController());
IpcHelper.registerIpcController(new AppController());
IpcHelper.registerIpcController(new UpdateController());
IpcHelper.registerIpcController(new GameController());
