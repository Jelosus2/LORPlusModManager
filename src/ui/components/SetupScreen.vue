<script setup lang="ts">
import FolderIcon from "./icons/FolderIcon.vue";
import SearchIcon from "./icons/SearchIcon.vue";

import { ref } from "vue";

const locationPath = ref("No location selected!");
const errorMessage = ref("");

let isProcessing = false;

async function setupGameLocation(manualSetup = false) {
    if (isProcessing)
        return;

    isProcessing = true;
    errorMessage.value = "";

    try {
        const result = await window.app.setupGameLocation(manualSetup);

        if (!result.success)
        {
            errorMessage.value = result.message;
            return;
        }

        locationPath.value = result.path;
    } catch (error) {
        console.error("Failed to set the game location:", error);
        errorMessage.value = "Something went wrong while locating the game.";
    } finally {
        isProcessing = false;
    }
}
</script>

<template>
    <main class="setup-page">
        <section class="setup-content" aria-labelledby="setup-title">
            <p class="setup-label">First-time setup</p>

            <h1 id="setup-title">Select the game location</h1>
            <p class="setup-description">
                To get started, select the folder where Last Origin R+ is installed.
                We can try to find it automatically, or you can choose it yourself.
            </p>

            <div class="location-path" aria-label="Selected game location">
                {{ locationPath }}
            </div>

            <p v-if="errorMessage" class="setup-error" role="alert" aria-live="polite">
                {{ errorMessage }}
            </p>

            <div class="setup-actions">
                <button class="button button--primary" type="button" @click="setupGameLocation()">
                    <SearchIcon class="button-icon" />
                    Locate automatically
                </button>
                <button class="button button--secondary" type="button" @click="setupGameLocation(true)">
                    <FolderIcon class="button-icon" />
                    Choose manually
                </button>
            </div>

            <p class="setup-note">You can change this later in settings.</p>
        </section>
    </main>
</template>

<style scoped>
.setup-page {
    display: flex;
    min-height: 100vh;
    align-items: center;
    justify-content: center;
    padding: clamp(32px, 8vw, 96px);
    background: #090b0a;
}

.setup-content {
    width: min(100%, 740px);
    padding: clamp(40px, 6vw, 64px);
    border: 1px solid #343936;
    border-radius: 16px;
    background: #090b0a;
}

.setup-label {
    margin: 0 0 18px;
    color: #9bc2d9;
    font-size: 14px;
    font-weight: 650;
}

h1 {
    margin: 0;
    color: #f2eee5;
    font-family: "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif;
    font-size: clamp(36px, 5vw, 48px);
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.15;
}

.setup-description {
    max-width: 590px;
    margin: 22px 0 28px;
    color: #c5c3bc;
    font-size: 17px;
    line-height: 1.6;
}

.location-path {
    width: 100%;
    min-height: 50px;
    margin-bottom: 18px;
    padding: 14px 16px;
    overflow: hidden;
    border: 1px solid #3a3f3c;
    border-radius: 3px;
    color: #b5bab4;
    background: #0c0e0d;
    font-family: Consolas, "Courier New", monospace;
    font-size: 14px;
    line-height: 20px;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.setup-error {
    margin: -2px 0 18px;
    color: #efa3a3;
    font-size: 14px;
    font-weight: 500;
    line-height: 1.5;
}

.setup-actions {
    display: flex;
    gap: 12px;
}

.button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    min-height: 52px;
    padding: 0 24px;
    border: 0;
    border-radius: 9px;
    font-size: 15px;
    font-weight: 650;
    cursor: pointer;
    transition: background-color 150ms ease, transform 150ms ease;
}

.button-icon {
    width: 19px;
    height: 19px;
    flex: 0 0 auto;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.button--primary {
    color: #172027;
    background: #86aec7;
}

.button--primary:hover {
    background: #9bbfd5;
}

.button--secondary {
    color: #242522;
    background: #ece7dc;
}

.button--secondary:hover {
    background: #f7f2e8;
}

.button:active {
    transform: translateY(1px);
}

.button:focus-visible {
    outline: 2px solid #f2eee5;
    outline-offset: 3px;
}

.setup-note {
    margin: 20px 0 0;
    color: #989c96;
    font-size: 14px;
    line-height: 1.5;
}

@media (max-width: 520px) {
    .setup-page {
        align-items: flex-start;
        padding: 40px 18px;
    }

    .setup-content {
        padding: 32px 24px;
    }

    .setup-actions {
        flex-direction: column;
    }

    .button {
        width: 100%;
    }
}

@media (prefers-reduced-motion: reduce) {
    .button {
        transition: none;
    }
}
</style>
