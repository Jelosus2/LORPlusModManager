import { ModSyncOperationJournal } from "./ModSyncOperationJournal.js";
import { ModOperationJournal } from "./ModOperationJournal.js";
import { ErrorUtils } from "#utils/ErrorUtils.js";

export class ModRecoveryCoordinator {
    private static recoveryPromise: Promise<void> | null = null;

    static waitUntilReady() {
        if (!ModRecoveryCoordinator.recoveryPromise)
        {
            ModRecoveryCoordinator.recoveryPromise = (
                async () => {
                    try
                    {
                        await new ModOperationJournal().recover();
                    }
                    catch (error)
                    {
                        throw ErrorUtils.withContext("The mod library recovery could not finish.", error);
                    }

                    try
                    {
                        await new ModSyncOperationJournal().recover();
                    }
                    catch (error)
                    {
                        throw ErrorUtils.withContext("The synchronization recovery could not finish.", error);
                    }
                }
            )().catch((error) => {
                ModRecoveryCoordinator.recoveryPromise = null;
                throw error;
            });
        }

        return ModRecoveryCoordinator.recoveryPromise;
    }
}
