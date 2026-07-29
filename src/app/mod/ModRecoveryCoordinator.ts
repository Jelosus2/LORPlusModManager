import { ModOperationJournal } from "./ModOperationJournal.js";

export class ModRecoveryCoordinator {
    private static recoveryPromise: Promise<void> | null = null;

    static waitUntilReady() {
        if (!ModRecoveryCoordinator.recoveryPromise)
        {
            ModRecoveryCoordinator.recoveryPromise = new ModOperationJournal()
                .recover()
                .catch((error) => {
                    ModRecoveryCoordinator.recoveryPromise = null;
                    throw error;
                });
        }

        return ModRecoveryCoordinator.recoveryPromise;
    }
}
