<script setup lang="ts">
import type { SetupState } from "../shared/setup.ts";

import SetupScreen from "./components/SetupScreen.vue";
import MainScreen from "./components/MainScreen.vue";

import { ErrorUtils } from "./utils/ErrorUtils.ts";
import { ref, onMounted } from "vue";

const setupState = ref<SetupState | null>(null);
const isLoading = ref(true);
const startupError = ref("");

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

onMounted(loadSetupState);
</script>

<template>
    <main v-if="isLoading" class="startup-state" aria-live="polite" aria-busy="true">
        <span class="startup-spinner" aria-hidden="true"></span>

        <div>
            <h1>Checking mod library</h1>
            <p>Cleaning up any interrupted operations.</p>
        </div>
    </main>

    <main v-else-if="startupError" class="startup-state">
        <p>{{ startupError }}</p>
        <button type="button" @click="loadSetupState">
            Try again
        </button>
    </main>

    <SetupScreen
        v-else-if="setupState && !setupState.isComplete"
        :initial-game-location="setupState.gameLocation"
        :initial-step="setupState.gameLocation ? 'plugin' : 'location'"
        @completed="loadSetupState"
    />

    <MainScreen v-else />
</template>

<style scoped>
.startup-state {
    display: flex;
    min-height: 100vh;
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

.startup-state button {
    min-height: 42px;
    padding: 0 18px;
    border: 0;
    border-radius: 7px;
    color: #172027;
    background: #86aec7;
    font: inherit;
    font-weight: 650;
    cursor: pointer;
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
</style>
