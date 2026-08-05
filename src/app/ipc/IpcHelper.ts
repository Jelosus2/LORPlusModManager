import { ApplicationLogger } from "#maintenance/ApplicationLogger.js";
import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { ErrorUtils } from "#utils/ErrorUtils.js";

type IpcHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown | Promise<unknown>;
type IpcRoute = { channel: string; methodName: string | symbol };

export class IpcHelper {
    private static routesByController = new WeakMap<(...args: unknown[]) => unknown, IpcRoute[]>();
    private static registeredChannels = new Set<string>();

    static IpcHandle(channel: string): MethodDecorator {
        return (target, methodName, descriptor) => {
            if (typeof descriptor.value !== "function")
                throw new Error(`@IpcHandle can only decorate methods: ${String(methodName)}`);

            const controller = target.constructor as (...args: unknown[]) => unknown;
            const routes = IpcHelper.routesByController.get(controller) ?? [];

            routes.push({ channel, methodName });
            IpcHelper.routesByController.set(controller, routes);
        };
    }

    static registerIpcController(controller: object) {
        const routes = IpcHelper.routesByController.get(controller.constructor as (...args: unknown[]) => unknown) ?? [];

        for (const route of routes)
        {
            if (IpcHelper.registeredChannels.has(route.channel))
                throw new Error(`IPC channel already registered: ${route.channel}`);

            const handler = controller[route.methodName as keyof typeof controller];
            if (typeof handler !== "function")
                throw new Error(`Invalid IPC handler: ${String(route.methodName)}`);

            ipcMain.handle(route.channel, async (event, ...args) => {
                try {
                    return await (handler as IpcHandler).call(controller, event, ...args);
                } catch (error) {
                    if (!ApplicationLogger.hasLoggedError(error))
                        ApplicationLogger.error(`IPC · ${route.channel}`, "The IPC operation failed.", error);

                    throw new Error(ErrorUtils.getUserErrorMessage(error, "The requested operation failed unexpectedly."), {
                        cause: error instanceof Error
                            ? error
                            : undefined
                    });
                }
            });

            IpcHelper.registeredChannels.add(route.channel);
        }
    }
}
