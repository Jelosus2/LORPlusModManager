<script setup lang="ts">
import type { SetupState } from "../shared/setup.ts";

import SetupScreen from "./components/SetupScreen.vue";
import MainScreen from "./components/MainScreen.vue";

import { ref, onMounted } from "vue";

const setupState = ref<SetupState | null>(null);
const isLoading = ref(true);
const startupError = ref("");

async function loadSetupState() {
    isLoading.value = true;
    startupError.value = "";

    try
    {
        setupState.value = await window.app.getSetupState();
    }
    catch (error)
    {
        console.error("Failed to load the setup state:", error);
        setupState.value = null;
        startupError.value = "Could not load the application state.";
    }
    finally
    {
        isLoading.value = false;
    }
}

onMounted(loadSetupState);
</script>

<template>
    <main v-if="isLoading" class="startup-state" aria-live="polite">
        Loading...
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
</style>
