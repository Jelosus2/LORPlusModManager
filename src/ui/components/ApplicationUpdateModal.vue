<script setup lang="ts">
import DownloadIcon from "./icons/DownloadIcon.vue";
import RefreshIcon from "./icons/RefreshIcon.vue";

import { useUpdateStore } from "@/stores/updateStore.ts";
import { computed } from "vue";
import { storeToRefs } from "pinia";

const updateStore = useUpdateStore();

const {
    applicationResult,
    isStartupModalOpen,
    isDownloading,
    isInstalling,
    isUpdateReady,
    downloadProgress,
    downloadError
} = storeToRefs(updateStore);

const releaseDate = computed(() => {
    const value = applicationResult.value?.release?.date;
    if (!value)
        return "";

    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
        return "";

    return new Intl.DateTimeFormat(undefined, {
        dateStyle: "long"
    }).format(date);
});

const downloadDetail = computed(() => {
    if (isUpdateReady.value)
        return "The update is ready. Restart the application to finish installing it.";

    const progress = downloadProgress.value;
    if (!progress || progress.totalBytes <= 0)
        return "Preparing the application update…";

    const transferred = formatBytes(progress.transferredBytes);
    const total = formatBytes(progress.totalBytes);
    const speed = progress.bytesPerSecond > 0
        ? ` · ${formatBytes(progress.bytesPerSecond)}/s`
        : "";

    return `${transferred} of ${total}${speed}`;
});

function formatBytes(value: number): string {
    if (!Number.isFinite(value) || value <= 0)
        return "0 B";

    const units = ["B", "KB", "MB", "GB"];
    const unitIndex = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    const amount = value / Math.pow(1024, unitIndex);

    return `${amount >= 10 || unitIndex === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unitIndex]}`;
}
</script>

<template>
    <Teleport to="body">
        <Transition name="application-update-modal">
            <div
                v-if="isStartupModalOpen && applicationResult"
                class="application-update-backdrop"
                @click.self="updateStore.closeStartupModal"
            >
                <section
                    class="application-update-modal"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="application-update-title"
                    aria-describedby="application-update-description"
                >
                    <header class="application-update-header">
                        <p>Application update</p>
                        <h2 id="application-update-title">
                            Version {{ applicationResult.latestVersion }} is available
                        </h2>
                        <span id="application-update-description">
                            Download it now, or continue using the current version and install it later.
                        </span>
                    </header>

                    <div class="application-update-versions" aria-label="Application versions">
                        <div>
                            <span>Installed</span>
                            <strong>{{ applicationResult.installedVersion || "Unknown" }}</strong>
                        </div>

                        <span class="application-update-version-arrow" aria-hidden="true">→</span>

                        <div>
                            <span>Available</span>
                            <strong>{{ applicationResult.latestVersion }}</strong>
                        </div>
                    </div>

                    <section class="application-update-release" aria-labelledby="release-notes-title">
                        <div class="application-update-release-heading">
                            <h3 id="release-notes-title">
                                {{ applicationResult.release?.name || "What’s new" }}
                            </h3>
                            <time
                                v-if="releaseDate"
                                :datetime="applicationResult.release?.date || undefined"
                            >
                                {{ releaseDate }}
                            </time>
                        </div>

                        <p v-if="applicationResult.release?.notes" class="application-update-notes">
                            {{ applicationResult.release.notes }}
                        </p>
                        <p v-else class="application-update-notes application-update-notes--empty">
                            No release notes were provided for this version.
                        </p>
                    </section>

                    <div
                        v-if="isDownloading || isUpdateReady"
                        class="application-update-download"
                        aria-live="polite"
                    >
                        <div class="application-update-download-heading">
                            <strong>
                                {{ isUpdateReady ? "Ready to install" : "Downloading update" }}
                            </strong>
                            <span>{{ Math.round(downloadProgress?.progress || 0) }}%</span>
                        </div>

                        <div
                            class="application-update-download-track"
                            role="progressbar"
                            aria-label="Application update download progress"
                            aria-valuemin="0"
                            aria-valuemax="100"
                            :aria-valuenow="Math.round(downloadProgress?.progress || 0)"
                        >
                            <span
                                class="application-update-download-fill"
                                :style="{ width: `${downloadProgress?.progress || 0}%` }"
                            ></span>
                        </div>

                        <p>{{ downloadDetail }}</p>
                    </div>

                    <p v-if="downloadError" class="application-update-error" role="alert">
                        {{ downloadError }}
                    </p>

                    <footer class="application-update-actions">
                        <button
                            class="application-update-button application-update-button--secondary"
                            type="button"
                            :disabled="isInstalling"
                            @click="updateStore.closeStartupModal"
                        >
                            {{ isDownloading ? "Continue in background" : "Not now" }}
                        </button>

                        <button
                            v-if="!isUpdateReady"
                            class="application-update-button application-update-button--primary"
                            type="button"
                            :disabled="isDownloading || isInstalling"
                            @click="updateStore.downloadApplicationUpdate"
                        >
                            <DownloadIcon class="application-update-button-icon" />
                            <span>
                                {{
                                    isDownloading
                                        ? `Downloading ${Math.round(downloadProgress?.progress || 0)}%`
                                        : "Download update"
                                }}
                            </span>
                        </button>

                        <button
                            v-else
                            class="application-update-button application-update-button--primary"
                            type="button"
                            :disabled="isInstalling"
                            @click="updateStore.installApplicationUpdate"
                        >
                            <RefreshIcon
                                class="application-update-button-icon"
                                :class="{
                                    'application-update-button-icon--spinning': isInstalling
                                }"
                            />
                            <span>{{ isInstalling ? "Restarting…" : "Restart and install" }}</span>
                        </button>
                    </footer>
                </section>
            </div>
        </Transition>
    </Teleport>
</template>

<style scoped>
.application-update-backdrop {
    position: fixed;
    z-index: 1000;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 20px;
    background: rgb(3 5 4 / 76%);
}

.application-update-modal {
    width: min(680px, 100%);
    max-height: calc(100vh - 40px);
    padding: 26px;
    overflow-y: auto;
    border: 1px solid #373d39;
    border-radius: 12px;
    color: #e9e5dd;
    background: #101411;
    box-shadow: 0 24px 64px rgb(0 0 0 / 52%);
}

.application-update-header p,
.application-update-header h2,
.application-update-header span,
.application-update-release h3,
.application-update-release p,
.application-update-download p,
.application-update-error {
    margin: 0;
}

.application-update-header p {
    color: #9bc2d9;
    font-size: 12px;
    font-weight: 700;
}

.application-update-header h2 {
    margin-top: 6px;
    color: #f2eee5;
    font-size: 25px;
    line-height: 1.25;
}

.application-update-header span {
    display: block;
    margin-top: 9px;
    color: #a1a8a2;
    font-size: 14px;
    line-height: 1.55;
}

.application-update-versions {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 16px;
    margin-top: 20px;
    padding: 14px 16px;
    border-radius: 8px;
    background: #0b0e0c;
}

.application-update-versions div {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 3px;
}

.application-update-versions div:last-child {
    text-align: right;
}

.application-update-versions span {
    color: #7f8781;
    font-size: 11px;
    font-weight: 650;
    text-transform: uppercase;
}

.application-update-versions strong {
    color: #e7e3db;
    font-size: 14px;
}

.application-update-version-arrow {
    color: #87b1ca !important;
    font-size: 18px !important;
}

.application-update-release {
    margin-top: 18px;
    padding: 16px;
    border-radius: 8px;
    background: #0b0e0c;
}

.application-update-release-heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 18px;
}

.application-update-release h3 {
    color: #e9e5dd;
    font-size: 15px;
    line-height: 1.4;
}

.application-update-release time {
    flex: 0 0 auto;
    color: #7f8781;
    font-size: 11px;
}

.application-update-notes {
    max-height: clamp(150px, 30vh, 280px);
    margin-top: 10px !important;
    padding-right: 10px;
    overflow-y: auto;
    color: #a9afa9;
    font-size: 13px;
    line-height: 1.6;
    white-space: pre-wrap;
}

.application-update-notes--empty {
    color: #777f79;
    font-style: italic;
}

.application-update-download {
    margin-top: 18px;
    padding: 13px 14px;
    border-radius: 8px;
    background: #111916;
}

.application-update-download-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
    color: #dcd9d2;
    font-size: 13px;
}

.application-update-download-heading span {
    color: #a5c9dd;
    font-size: 12px;
    font-weight: 700;
}

.application-update-download-track {
    height: 7px;
    margin-top: 9px;
    overflow: hidden;
    border-radius: 4px;
    background: #29302c;
}

.application-update-download-fill {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: #91b8cf;
    transition: width 160ms ease;
}

.application-update-download p {
    margin-top: 7px;
    color: #858d87;
    font-size: 11px;
    line-height: 1.45;
}

.application-update-error {
    margin-top: 16px;
    padding: 11px 13px;
    border-radius: 6px;
    color: #efaaa5;
    background: #281918;
    font-size: 13px;
    line-height: 1.5;
}

.application-update-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 22px;
}

.application-update-button {
    display: inline-flex;
    min-height: 42px;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 0 16px;
    border: 0;
    border-radius: 7px;
    font: inherit;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
}

.application-update-button--secondary {
    color: #e5e1d9;
    background: #1a1f1c;
}

.application-update-button--secondary:hover {
    background: #242a26;
}

.application-update-button--primary {
    color: #0c151a;
    background: #91b8cf;
}

.application-update-button--primary:hover {
    background: #a1c4d7;
}

.application-update-button:disabled {
    color: #656b67;
    background: #191c1a;
    cursor: not-allowed;
}

.application-update-button:focus-visible {
    outline: 2px solid #f2eee5;
    outline-offset: 2px;
}

.application-update-button-icon {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.application-update-button-icon--spinning {
    animation: application-update-spin 900ms linear infinite;
}

.application-update-modal-enter-active,
.application-update-modal-leave-active {
    transition: opacity 150ms ease;
}

.application-update-modal-enter-active .application-update-modal,
.application-update-modal-leave-active .application-update-modal {
    transition: transform 150ms ease, opacity 150ms ease;
}

.application-update-modal-enter-from,
.application-update-modal-leave-to {
    opacity: 0;
}

.application-update-modal-enter-from .application-update-modal,
.application-update-modal-leave-to .application-update-modal {
    opacity: 0;
    transform: translateY(7px) scale(0.99);
}

@keyframes application-update-spin {
    to {
        transform: rotate(360deg);
    }
}

@media (max-width: 540px) {
    .application-update-backdrop {
        padding: 12px;
    }

    .application-update-modal {
        max-height: calc(100vh - 24px);
        padding: 20px;
    }

    .application-update-release-heading,
    .application-update-actions {
        align-items: stretch;
        flex-direction: column;
    }

    .application-update-release-heading {
        gap: 5px;
    }

    .application-update-actions .application-update-button {
        width: 100%;
    }
}

@media (prefers-reduced-motion: reduce) {
    .application-update-modal-enter-active,
    .application-update-modal-leave-active,
    .application-update-modal-enter-active .application-update-modal,
    .application-update-modal-leave-active .application-update-modal,
    .application-update-download-fill {
        transition: none;
    }

    .application-update-button-icon--spinning {
        animation: none;
    }
}
</style>
