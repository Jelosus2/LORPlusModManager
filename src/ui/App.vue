<script setup lang="ts">
import type { SetupState } from "../shared/setup.ts";

import SetupScreen from "./components/SetupScreen.vue";
import MainScreen from "./components/MainScreen.vue";
import TitleBar from "./components/TitleBar.vue";

import { ErrorUtils } from "./utils/ErrorUtils.ts";
import { ref, onMounted } from "vue";

const setupState = ref<SetupState | null>(null);
const isLoading = ref(true);
const startupError = ref("");
const recoveryFolderError = ref("");

async function loadSetupState() {
    isLoading.value = true;
    startupError.value = "";

    try
    {
        await window.app.recoverInterruptedModOperations();
        setupState.value = await window.app.getSetupState();
    }
    catch (error)
    {
        console.error("Failed to initialize the application:", error);

        setupState.value = null;
        startupError.value = ErrorUtils.getUserErrorMessage(error, "Could not finish checking the mod library.");
    }
    finally
    {
        isLoading.value = false;
    }
}

async function openRecoveryFolder() {
    recoveryFolderError.value = "";

    try
    {
        await window.app.openRecoveryFolder();
    }
    catch (error)
    {
        console.error("Could not open the recovery folder:", error);

        recoveryFolderError.value = ErrorUtils.getUserErrorMessage(error, "The recovery folder could not be opened.");
    }
}

onMounted(loadSetupState);
</script>

<template>
    <div class="application-frame">
        <TitleBar />

        <div class="application-content">
            <main
                v-if="isLoading"
                class="startup-state"
                aria-live="polite"
                aria-busy="true"
            >
                <span class="startup-spinner" aria-hidden="true"></span>

                <div>
                    <h1>Checking mod library</h1>
                    <p>Cleaning up any interrupted operations.</p>
                </div>
            </main>

            <main v-else-if="startupError" class="startup-state startup-state--error">
                <section class="startup-recovery-error" aria-labelledby="startup-recovery-title">
                    <p class="startup-error-label">Recovery could not finish</p>
                    <h1 id="startup-recovery-title">The mod library needs attention</h1>
                    <p class="startup-error-message" role="alert">{{ startupError }}</p>
                    <p class="startup-error-help">
                        Open the recovery folder to inspect the operation records, then try the check again.
                    </p>

                    <p v-if="recoveryFolderError" class="startup-folder-error" role="alert">
                        {{ recoveryFolderError }}
                    </p>

                    <div class="startup-error-actions">
                        <button
                            type="button"
                            class="startup-button startup-button--secondary"
                            @click="openRecoveryFolder"
                        >
                            Open recovery folder
                        </button>
                        <button
                            type="button"
                            class="startup-button startup-button--primary"
                            @click="loadSetupState"
                        >
                            Try again
                        </button>
                    </div>
                </section>
            </main>

            <SetupScreen
                v-else-if="setupState && !setupState.isComplete"
                :initial-game-location="setupState.gameLocation"
                :initial-step="setupState.gameLocation ? 'plugin' : 'location'"
                @completed="loadSetupState"
            />

            <MainScreen v-else />
        </div>
    </div>
</template>

<style scoped>
.application-frame {
    display: flex;
    width: 100%;
    height: 100vh;
    min-height: 0;
    overflow: hidden;
    flex-direction: column;
    background: #090b0a;
}

.application-content {
    width: 100%;
    min-height: 0;
    flex: 1;
    overflow: hidden;
    border-top: 1px solid #28302c;
}

.startup-state {
    display: flex;
    height: 100%;
    min-height: 0;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 16px;
    color: #c5c3bc;
    background: #090b0a;
}

.startup-state p {
    margin: 0;
    color: #949b97;
}

.startup-recovery-error {
    width: min(680px, calc(100vw - 40px));
    padding: 30px;
    border: 1px solid #28302d;
    border-radius: 10px;
    background: #0f1311;
}

.startup-state .startup-recovery-error h1 {
    margin: 5px 0 12px;
    color: #f0ede5;
    font-size: clamp(22px, 3vw, 28px);
}

.startup-recovery-error .startup-error-label {
    color: #86aec7;
    font-size: 13px;
    font-weight: 650;
}

.startup-recovery-error .startup-error-message {
    color: #d6d3cb;
    line-height: 1.6;
    overflow-wrap: anywhere;
}

.startup-recovery-error .startup-error-help {
    margin-top: 10px;
    color: #8d9691;
    line-height: 1.5;
}

.startup-recovery-error .startup-folder-error {
    margin-top: 16px;
    padding: 11px 13px;
    border-radius: 6px;
    color: #e2a4a4;
    background: #241616;
    line-height: 1.45;
}

.startup-error-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 24px;
}

.startup-button {
    min-height: 42px;
    padding: 0 18px;
    border: 0;
    border-radius: 7px;
    font: inherit;
    font-weight: 650;
    cursor: pointer;
}

.startup-button--primary {
    color: #172027;
    background: #86aec7;
}

.startup-button--secondary {
    color: #e6e2d9;
    background: #1a201d;
}

.startup-button:hover {
    filter: brightness(1.08);
}

.startup-button:focus-visible {
    outline: 2px solid #9bc1d8;
    outline-offset: 3px;
}

.startup-state h1 {
    margin: 0 0 6px;
    color: #f0ede5;
    font-size: 20px;
}

.startup-spinner {
    width: 24px;
    height: 24px;
    border: 3px solid #26302d;
    border-top-color: #86aec7;
    border-radius: 50%;
    animation: startup-spin 0.8s linear infinite;
}

@keyframes startup-spin {
    to {
        transform: rotate(360deg);
    }
}

@media (prefers-reduced-motion: reduce) {
    .startup-spinner {
        animation-duration: 1.6s;
    }
}

@media (max-width: 560px) {
    .startup-recovery-error {
        width: calc(100vw - 24px);
        padding: 22px;
    }

    .startup-error-actions {
        flex-direction: column-reverse;
    }

    .startup-button {
        width: 100%;
    }
}
</style>
