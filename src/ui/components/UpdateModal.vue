<script setup lang="ts">
import CheckIcon from "./icons/CheckIcon.vue";
import DownloadIcon from "./icons/DownloadIcon.vue";
import RefreshIcon from "./icons/RefreshIcon.vue";

import { useUpdateStore } from "@/stores/updateStore.ts";
import { computed } from "vue";
import { storeToRefs } from "pinia";

type ActiveUpdate = "application" | "plugin";

const updateStore = useUpdateStore();

const {
    applicationResult,
    isStartupModalOpen,
    isDownloading,
    isInstalling,
    isUpdateReady,
    downloadProgress,
    downloadError,
    pluginResult,
    isPluginUpdateModalOpen,
    isUpdatingPlugin,
    isPluginUpdateComplete,
    pluginUpdateProgress,
    pluginUpdateError
} = storeToRefs(updateStore);

const activeUpdate = computed<ActiveUpdate | null>(() => {
    if (isStartupModalOpen.value && applicationResult.value)
        return "application";
    if (isPluginUpdateModalOpen.value && pluginResult.value)
        return "plugin";

    return null;
});

const isOpen = computed(() => activeUpdate.value !== null);

const activeResult = computed(() => activeUpdate.value === "application"
    ? applicationResult.value
    : pluginResult.value
);

const modalLabel = computed(() => activeUpdate.value === "application"
    ? "Application update"
    : "Plugin update"
);

const modalTitle = computed(() => {
    const result = activeResult.value;
    if (!result)
        return "Update available";

    if (activeUpdate.value === "plugin")
    {
        return isPluginUpdateComplete.value
            ? `LOPlugin+ ${result.installedVersion ?? result.latestVersion} installed`
            : `LOPlugin+ ${result.latestVersion} is available`;
    }

    return `Version ${result.latestVersion} is available`;
});

const modalDescription = computed(() => {
    if (activeUpdate.value === "plugin")
    {
        return isPluginUpdateComplete.value
            ? "The plugin update completed successfully."
            : "Close Last Origin R+ before updating. The release will be installed in your configured game folder.";
    }

    return "Download it now, or continue using the current version and install it later.";
});

const showVersionComparison = computed(() => activeUpdate.value === "application" || !isPluginUpdateComplete.value);

const releaseDate = computed(() => {
    if (activeUpdate.value !== "application")
        return "";

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

const applicationDownloadDetail = computed(() => {
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

const pluginProgressDetail = computed(() => {
    const progress = pluginUpdateProgress.value;
    const downloaded = progress?.downloadedBytes ?? 0;
    const total = progress?.totalBytes ?? 0;

    if (total <= 0)
        return "Downloading and installing the release in your configured game folder.";

    return `${formatBytes(downloaded)} of ${formatBytes(total)}`;
});

function formatBytes(value: number): string {
    if (!Number.isFinite(value) || value <= 0)
        return "0 B";

    const units = ["B", "KB", "MB", "GB"];
    const unitIndex = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    const amount = value / Math.pow(1024, unitIndex);

    return `${amount >= 10 || unitIndex === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unitIndex]}`;
}

function closeModal(): void {
    if (activeUpdate.value === "application")
        updateStore.closeStartupModal();
    else if (activeUpdate.value === "plugin")
        updateStore.closePluginUpdateModal();
}
</script>

<template>
    <Teleport to="body">
        <Transition name="update-modal">
            <div
                v-if="isOpen && activeResult"
                class="update-modal-backdrop"
                @click.self="closeModal"
            >
                <section
                    class="update-modal"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="update-modal-title"
                    aria-describedby="update-modal-description"
                >
                    <header class="update-modal-header">
                        <p>{{ modalLabel }}</p>
                        <h2 id="update-modal-title">{{ modalTitle }}</h2>
                        <span id="update-modal-description">{{ modalDescription }}</span>
                    </header>

                    <div
                        v-if="showVersionComparison"
                        class="update-modal-versions"
                        :aria-label="`${modalLabel} versions`"
                    >
                        <div>
                            <span>Installed</span>
                            <strong>{{ activeResult.installedVersion || "Unknown" }}</strong>
                        </div>

                        <span class="update-modal-version-arrow" aria-hidden="true">→</span>

                        <div>
                            <span>Available</span>
                            <strong>{{ activeResult.latestVersion }}</strong>
                        </div>
                    </div>

                    <template v-if="activeUpdate === 'application'">
                        <section class="update-modal-release" aria-labelledby="release-notes-title">
                            <div class="update-modal-release-heading">
                                <h3 id="release-notes-title">
                                    {{ applicationResult?.release?.name || "What’s new" }}
                                </h3>
                                <time
                                    v-if="releaseDate"
                                    :datetime="applicationResult?.release?.date || undefined"
                                >
                                    {{ releaseDate }}
                                </time>
                            </div>

                            <p v-if="applicationResult?.release?.notes" class="update-modal-notes">
                                {{ applicationResult.release.notes }}
                            </p>
                            <p v-else class="update-modal-notes update-modal-notes--empty">
                                No release notes were provided for this version.
                            </p>
                        </section>

                        <div
                            v-if="isDownloading || isUpdateReady"
                            class="update-modal-progress"
                            aria-live="polite"
                        >
                            <div class="update-modal-progress-heading">
                                <strong>
                                    {{ isUpdateReady ? "Ready to install" : "Downloading update" }}
                                </strong>
                                <span>{{ Math.round(downloadProgress?.progress || 0) }}%</span>
                            </div>

                            <div
                                class="update-modal-progress-track"
                                role="progressbar"
                                aria-label="Application update download progress"
                                aria-valuemin="0"
                                aria-valuemax="100"
                                :aria-valuenow="Math.round(downloadProgress?.progress || 0)"
                            >
                                <span
                                    class="update-modal-progress-fill"
                                    :style="{ width: `${downloadProgress?.progress || 0}%` }"
                                ></span>
                            </div>

                            <p>{{ applicationDownloadDetail }}</p>
                        </div>

                        <p v-if="downloadError" class="update-modal-error" role="alert">
                            {{ downloadError }}
                        </p>
                    </template>

                    <template v-else>
                        <div v-if="!isPluginUpdateComplete" class="update-modal-notice">
                            <p>
                                Existing release files with the same names will be overwritten.
                                Other BepInEx files and imported mods stored by the mod manager are
                                preserved.
                            </p>
                        </div>

                        <div v-else class="update-modal-complete" role="status">
                            <CheckIcon class="update-modal-complete-icon" />
                            <p>LOPlugin+ is up to date and ready to use.</p>
                        </div>

                        <div
                            v-if="isUpdatingPlugin"
                            class="update-modal-progress"
                            aria-live="polite"
                        >
                            <div class="update-modal-progress-heading">
                                <strong>
                                    {{ pluginUpdateProgress?.status || "Preparing LOPlugin+ update…" }}
                                </strong>
                                <span>{{ Math.round(pluginUpdateProgress?.progress || 0) }}%</span>
                            </div>

                            <div
                                class="update-modal-progress-track"
                                role="progressbar"
                                aria-label="LOPlugin+ update progress"
                                aria-valuemin="0"
                                aria-valuemax="100"
                                :aria-valuenow="Math.round(pluginUpdateProgress?.progress || 0)"
                            >
                                <span
                                    class="update-modal-progress-fill"
                                    :style="{ width: `${pluginUpdateProgress?.progress || 0}%` }"
                                ></span>
                            </div>

                            <p>{{ pluginProgressDetail }}</p>
                        </div>

                        <p v-if="pluginUpdateError" class="update-modal-error" role="alert">
                            {{ pluginUpdateError }}
                        </p>
                    </template>

                    <footer class="update-modal-actions">
                        <template v-if="activeUpdate === 'application'">
                            <button
                                class="update-modal-button update-modal-button--secondary"
                                type="button"
                                :disabled="isInstalling"
                                @click="closeModal"
                            >
                                {{ isDownloading ? "Continue in background" : "Not now" }}
                            </button>

                            <button
                                v-if="!isUpdateReady"
                                class="update-modal-button update-modal-button--primary"
                                type="button"
                                :disabled="isDownloading || isInstalling"
                                @click="updateStore.downloadApplicationUpdate"
                            >
                                <DownloadIcon class="update-modal-button-icon" />
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
                                class="update-modal-button update-modal-button--primary"
                                type="button"
                                :disabled="isInstalling"
                                @click="updateStore.installApplicationUpdate"
                            >
                                <RefreshIcon
                                    class="update-modal-button-icon"
                                    :class="{
                                        'update-modal-button-icon--spinning': isInstalling
                                    }"
                                />
                                <span>{{ isInstalling ? "Restarting…" : "Restart and install" }}</span>
                            </button>
                        </template>

                        <template v-else>
                            <button
                                class="update-modal-button update-modal-button--secondary"
                                type="button"
                                :disabled="isUpdatingPlugin"
                                @click="closeModal"
                            >
                                {{ isPluginUpdateComplete ? "Done" : "Not now" }}
                            </button>

                            <button
                                v-if="!isPluginUpdateComplete"
                                class="update-modal-button update-modal-button--primary"
                                type="button"
                                :disabled="isUpdatingPlugin"
                                @click="updateStore.updatePlugin"
                            >
                                <RefreshIcon
                                    class="update-modal-button-icon"
                                    :class="{
                                        'update-modal-button-icon--spinning': isUpdatingPlugin
                                    }"
                                />
                                <span>{{ isUpdatingPlugin ? "Updating…" : "Update LOPlugin+" }}</span>
                            </button>
                        </template>
                    </footer>
                </section>
            </div>
        </Transition>
    </Teleport>
</template>

<style scoped>
.update-modal-backdrop {
    position: fixed;
    z-index: 1000;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 20px;
    background: rgb(3 5 4 / 76%);
}

.update-modal {
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

.update-modal-header p,
.update-modal-header h2,
.update-modal-header span,
.update-modal-release h3,
.update-modal-release p,
.update-modal-notice p,
.update-modal-complete p,
.update-modal-progress p,
.update-modal-error {
    margin: 0;
}

.update-modal-header p {
    color: #9bc2d9;
    font-size: 12px;
    font-weight: 700;
}

.update-modal-header h2 {
    margin-top: 6px;
    color: #f2eee5;
    font-size: 25px;
    line-height: 1.25;
}

.update-modal-header span {
    display: block;
    margin-top: 9px;
    color: #a1a8a2;
    font-size: 14px;
    line-height: 1.55;
}

.update-modal-versions {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 16px;
    margin-top: 20px;
    padding: 14px 16px;
    border-radius: 8px;
    background: #0b0e0c;
}

.update-modal-versions div {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 3px;
}

.update-modal-versions div:last-child {
    align-items: flex-end;
    text-align: right;
}

.update-modal-versions span:not(.update-modal-version-arrow) {
    color: #7f8781;
    font-size: 11px;
    font-weight: 650;
    text-transform: uppercase;
}

.update-modal-versions strong {
    color: #e7e3db;
    font-size: 14px;
}

.update-modal-version-arrow {
    color: #87b1ca;
    font-size: 18px;
}

.update-modal-release {
    margin-top: 18px;
    padding: 16px;
    border-radius: 8px;
    background: #0b0e0c;
}

.update-modal-release-heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 18px;
}

.update-modal-release h3 {
    color: #e9e5dd;
    font-size: 15px;
    line-height: 1.4;
}

.update-modal-release time {
    flex: 0 0 auto;
    color: #7f8781;
    font-size: 11px;
}

.update-modal-notes {
    max-height: clamp(150px, 30vh, 280px);
    margin-top: 10px !important;
    padding-right: 10px;
    overflow-y: auto;
    color: #a9afa9;
    font-size: 13px;
    line-height: 1.6;
    white-space: pre-wrap;
}

.update-modal-notes--empty {
    color: #777f79;
    font-style: italic;
}

.update-modal-notice {
    margin-top: 18px;
    padding: 13px 15px;
    border-left: 3px solid #6f9bb3;
    border-radius: 5px;
    background: #131a1d;
}

.update-modal-notice p {
    color: #aeb5b0;
    font-size: 13px;
    line-height: 1.55;
}

.update-modal-complete {
    display: flex;
    align-items: center;
    gap: 11px;
    margin-top: 18px;
    padding: 14px 15px;
    border-radius: 7px;
    color: #9fcab6;
    background: #102019;
}

.update-modal-complete p {
    color: #b4c9bf;
    font-size: 13px;
    font-weight: 600;
}

.update-modal-complete-icon {
    width: 17px;
    height: 17px;
    flex: 0 0 auto;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.update-modal-progress {
    margin-top: 18px;
    padding: 13px 14px;
    border-radius: 8px;
    background: #111916;
}

.update-modal-progress-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
    color: #dcd9d2;
    font-size: 13px;
}

.update-modal-progress-heading strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.update-modal-progress-heading span {
    flex: 0 0 auto;
    color: #a5c9dd;
    font-size: 12px;
    font-weight: 700;
}

.update-modal-progress-track {
    height: 7px;
    margin-top: 9px;
    overflow: hidden;
    border-radius: 4px;
    background: #29302c;
}

.update-modal-progress-fill {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: #91b8cf;
    transition: width 160ms ease;
}

.update-modal-progress p {
    margin-top: 7px;
    color: #858d87;
    font-size: 11px;
    line-height: 1.45;
}

.update-modal-error {
    margin-top: 16px;
    padding: 11px 13px;
    border-radius: 6px;
    color: #efaaa5;
    background: #281918;
    font-size: 13px;
    line-height: 1.5;
}

.update-modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 22px;
}

.update-modal-button {
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

.update-modal-button--secondary {
    color: #e5e1d9;
    background: #1a1f1c;
}

.update-modal-button--secondary:hover:not(:disabled) {
    background: #242a26;
}

.update-modal-button--primary {
    color: #0c151a;
    background: #91b8cf;
}

.update-modal-button--primary:hover:not(:disabled) {
    background: #a1c4d7;
}

.update-modal-button:disabled {
    color: #656b67;
    background: #191c1a;
    cursor: not-allowed;
}

.update-modal-button:focus-visible {
    outline: 2px solid #f2eee5;
    outline-offset: 2px;
}

.update-modal-button-icon {
    width: 16px;
    height: 16px;
    flex: 0 0 auto;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.update-modal-button-icon--spinning {
    animation: update-modal-spin 900ms linear infinite;
}

.update-modal-enter-active,
.update-modal-leave-active {
    transition: opacity 150ms ease;
}

.update-modal-enter-active .update-modal,
.update-modal-leave-active .update-modal {
    transition: transform 150ms ease, opacity 150ms ease;
}

.update-modal-enter-from,
.update-modal-leave-to {
    opacity: 0;
}

.update-modal-enter-from .update-modal,
.update-modal-leave-to .update-modal {
    opacity: 0;
    transform: translateY(7px) scale(0.99);
}

@keyframes update-modal-spin {
    to {
        transform: rotate(360deg);
    }
}

@media (max-width: 540px) {
    .update-modal-backdrop {
        padding: 12px;
    }

    .update-modal {
        max-height: calc(100vh - 24px);
        padding: 20px;
    }

    .update-modal-release-heading,
    .update-modal-actions {
        align-items: stretch;
        flex-direction: column;
    }

    .update-modal-release-heading {
        gap: 5px;
    }

    .update-modal-button {
        width: 100%;
    }
}

@media (prefers-reduced-motion: reduce) {
    .update-modal-enter-active,
    .update-modal-leave-active,
    .update-modal-enter-active .update-modal,
    .update-modal-leave-active .update-modal,
    .update-modal-progress-fill {
        transition: none;
    }

    .update-modal-button-icon--spinning {
        animation: none;
    }
}
</style>
