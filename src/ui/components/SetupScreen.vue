<script setup lang="ts">
import ArrowLeftIcon from "./icons/ArrowLeftIcon.vue";
import ArrowRightIcon from "./icons/ArrowRightIcon.vue";
import FolderIcon from "./icons/FolderIcon.vue";
import SearchIcon from "./icons/SearchIcon.vue";

import { ref } from "vue";

type SetupStep = "location" | "plugin";

const currentStep = ref<SetupStep>("location");
const locationPath = ref("No location selected");
const downloadStatus = ref("");
const downloadProgress = ref<number | null>(null);
const isDownloading = ref(false);
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

async function downloadLOPlugin() {
    if (isDownloading.value)
        return;

    isDownloading.value = true;
    errorMessage.value = "";
    downloadStatus.value = "Preparing download...";
    downloadProgress.value = 0;

    const removeProgressListener = window.app.onLOPluginDownloadProgress((progress) => {
        downloadStatus.value = progress.status;
        downloadProgress.value = progress.progress;
    });

    try {
        const result = await window.app.downloadLOPlugin();

        if (!result.success)
        {
            errorMessage.value = result.message;
            downloadProgress.value = null;
            return;
        }

        downloadStatus.value = `LOPlugin+ ${result.version} downloaded`;
        downloadProgress.value = 100;
    } catch (error) {
        console.error("Failed to download LOPlugin+:", error);

        errorMessage.value = "Something went wrong while downloading LOPlugin+.";
        downloadProgress.value = null;
    } finally {
        removeProgressListener();
        isDownloading.value = false;
    }
}

function goToLocationStep() {
    currentStep.value = "location";
}

function goToPluginStep() {
    if (locationPath.value == "No location selected")
        return;

    errorMessage.value = "";
    currentStep.value = "plugin";
}
</script>

<template>
    <main class="setup-page">
        <Transition name="setup-step" mode="out-in">
            <section
                v-if="currentStep === 'location'"
                key="location"
                class="setup-content"
                aria-labelledby="setup-title"
            >
                <div class="setup-header">
                    <p class="setup-label">First-time setup · Step 1</p>
                    <button
                        v-if="locationPath !== 'No location selected'"
                        class="continue-button"
                        type="button"
                        aria-label="Continue to the LOPlugin+ setup step"
                        @click="goToPluginStep"
                    >
                        <ArrowRightIcon class="navigation-icon" />
                    </button>
                </div>

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

            <section
                v-else
                key="plugin"
                class="setup-content"
                aria-labelledby="plugin-title"
            >
                <div class="setup-header setup-header--back">
                    <button
                        class="back-button"
                        type="button"
                        aria-label="Return to the game location setup step"
                        @click="goToLocationStep"
                    >
                        <ArrowLeftIcon class="navigation-icon" />
                    </button>
                    <p class="setup-label">First-time setup · Step 2</p>
                </div>

                <h1 id="plugin-title">Install LOPlugin+</h1>
                <p class="setup-description">
                    LOPlugin+ allows the mod manager to work with Last Origin R+.
                    Download it now to finish preparing your game for mods.
                </p>

                <div
                    v-if="downloadProgress !== null"
                    class="download-progress"
                    aria-live="polite"
                >
                    <div class="download-progress-header">
                        <span>{{ downloadStatus }}</span>
                        <span>{{ Math.round(downloadProgress) }}%</span>
                    </div>
                    <div
                        class="download-progress-track"
                        role="progressbar"
                        aria-label="LOPlugin+ download progress"
                        aria-valuemin="0"
                        aria-valuemax="100"
                        :aria-valuenow="downloadProgress"
                    >
                        <div
                            class="download-progress-fill"
                            :style="{ width: `${downloadProgress}%` }"
                        ></div>
                    </div>
                </div>

                <p
                    v-if="currentStep === 'plugin' && errorMessage"
                    class="setup-error"
                    role="alert"
                    aria-live="polite"
                >
                    {{ errorMessage }}
                </p>

                <div class="setup-actions">
                    <button
                        class="button button--primary"
                        type="button"
                        :disabled="isDownloading || downloadProgress === 100"
                        @click="downloadLOPlugin"
                    >
                        {{
                            downloadProgress === 100
                                ? "Downloaded"
                                : isDownloading
                                    ? "Downloading..."
                                    : "Download LOPlugin+"
                        }}
                    </button>
                </div>

                <p class="setup-note">
                    The plugin will be installed in your selected game folder.
                </p>
            </section>
        </Transition>
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
    min-height: 480px;
    padding: clamp(40px, 6vw, 64px);
    border: 1px solid #343936;
    border-radius: 16px;
    background: #090b0a;
}

.setup-header {
    display: flex;
    min-height: 34px;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    margin-bottom: 14px;
}

.setup-header--back {
    justify-content: flex-start;
    gap: 10px;
}

.setup-label {
    margin: 0;
    color: #9bc2d9;
    font-size: 14px;
    font-weight: 650;
}

.continue-button,
.back-button {
    display: inline-flex;
    width: 34px;
    height: 34px;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    border-radius: 7px;
    color: #f2eee5;
    background: transparent;
    cursor: pointer;
    transition: color 150ms ease, background-color 150ms ease, transform 150ms ease;
}

.continue-button {
    animation: continue-button-in 220ms ease-out both;
}

.continue-button:hover,
.back-button:hover {
    color: #ffffff;
    background: #151a1c;
}

.continue-button:active {
    transform: translateX(1px);
}

.back-button:active {
    transform: translateX(-1px);
}

.continue-button:focus-visible,
.back-button:focus-visible {
    outline: 2px solid #f2eee5;
    outline-offset: 2px;
}

.navigation-icon {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
}

@keyframes continue-button-in {
    from {
        opacity: 0;
        transform: translateX(-6px);
    }

    to {
        opacity: 1;
        transform: translateX(0);
    }
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

.download-progress {
    margin-bottom: 18px;
}

.download-progress-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    margin-bottom: 9px;
    color: #c5c3bc;
    font-size: 14px;
    font-weight: 600;
}

.download-progress-track {
    width: 100%;
    height: 8px;
    overflow: hidden;
    border-radius: 4px;
    background: #252927;
}

.download-progress-fill {
    height: 100%;
    border-radius: inherit;
    background: #86aec7;
    transition: width 180ms ease;
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

.button--primary:disabled,
.button--primary:disabled:hover {
    background: #86aec7;
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

.button:disabled {
    cursor: default;
    opacity: 0.65;
    transform: none;
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

.setup-step-enter-active,
.setup-step-leave-active {
    transition: opacity 180ms ease, transform 180ms ease;
}

.setup-step-enter-from {
    opacity: 0;
    transform: translateX(14px);
}

.setup-step-leave-to {
    opacity: 0;
    transform: translateX(-14px);
}

@media (max-width: 520px) {
    .setup-page {
        align-items: flex-start;
        padding: 40px 18px;
    }

    .setup-content {
        min-height: 0;
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
    .button,
    .continue-button,
    .back-button {
        transition: none;
    }

    .continue-button {
        animation: none;
    }

    .setup-step-enter-active,
    .setup-step-leave-active {
        transition: none;
    }

    .download-progress-fill {
        transition: none;
    }
}
</style>
