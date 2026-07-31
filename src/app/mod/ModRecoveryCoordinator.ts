import { ModSyncOperationJournal } from "./ModSyncOperationJournal.js";
import { ModOperationJournal } from "./ModOperationJournal.js";

export class ModRecoveryCoordinator {
    private static recoveryPromise: Promise<void> | null = null;

    static waitUntilReady() {
        if (!ModRecoveryCoordinator.recoveryPromise)
        {
            ModRecoveryCoordinator.recoveryPromise = (
                async () => {
                    await new ModOperationJournal().recover();
                    await new ModSyncOperationJournal().recover();
                }
            )().catch((error) => {
                ModRecoveryCoordinator.recoveryPromise = null;
                throw error;
            });
        }

        return ModRecoveryCoordinator.recoveryPromise;
    }
}
