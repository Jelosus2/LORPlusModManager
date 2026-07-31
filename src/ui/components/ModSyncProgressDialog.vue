<script setup lang="ts">
import CheckIcon from "./icons/CheckIcon.vue";
import MinusIcon from "./icons/MinusIcon.vue";
import UnlinkIcon from "./icons/UnlinkIcon.vue";
import WarningIcon from "./icons/WarningIcon.vue";

import { computed, ref } from "vue";

type SyncLogStatus = "synced" | "failed" | "unsynced" | "unchanged";

type SyncLogEntry = Readonly<{
    modId: string;
    directoryName: string;
    status: SyncLogStatus;
    message: string;
}>;

const props = defineProps<{
    busy: boolean;
    progress: number;
    status: string;
    detail: string;
    entries: readonly SyncLogEntry[];
}>();

const emit = defineEmits<{
    done: [];
}>();

const dialog = ref<HTMLDialogElement | null>(null);
const displayedProgress = computed(() => Math.min(100, Math.max(0, Math.round(props.progress))));

function showModal() {
    if (!dialog.value?.open)
        dialog.value?.showModal();
}

function requestClose() {
    if (props.busy)
        return;

    dialog.value?.close();
    emit("done");
}

function statusLabel(status: SyncLogStatus) {
    switch (status)
    {
        case "synced":
            return "Synchronized";
        case "failed":
            return "Failed";
        case "unsynced":
            return "Unsynchronized";
        case "unchanged":
            return "No changes";
    }
}

defineExpose({ showModal });
</script>

<template>
    <dialog
        ref="dialog"
        class="sync-progress-dialog"
        aria-labelledby="sync-progress-title"
        @cancel.prevent="requestClose"
    >
        <div class="sync-progress-layout">
            <header class="sync-progress-header">
                <p class="sync-progress-label">Synchronize mods</p>
                <h2 id="sync-progress-title">
                    {{ busy ? "Applying mod changes" : "Synchronization results" }}
                </h2>

                <div class="sync-progress-status">
                    <div>
                        <strong>{{ status }}</strong>
                        <span>{{ detail }}</span>
                    </div>

                    <strong>{{ displayedProgress }}%</strong>
                </div>

                <div
                    class="sync-progress-track"
                    role="progressbar"
                    aria-label="Mod synchronization progress"
                    aria-valuemin="0"
                    aria-valuemax="100"
                    :aria-valuenow="displayedProgress"
                    :aria-valuetext="status"
                >
                    <span
                        class="sync-progress-fill"
                        :style="{ width: `${displayedProgress}%` }"
                    ></span>
                </div>
            </header>

            <section
                class="sync-log"
                aria-labelledby="sync-log-title"
                aria-live="polite"
            >
                <div class="sync-log-heading">
                    <h3 id="sync-log-title">Synchronization log</h3>
                    <span>{{ entries.length }}</span>
                </div>

                <p v-if="entries.length === 0" class="sync-log-empty">
                    Preparing the mod list…
                </p>

                <ul v-else>
                    <li
                        v-for="entry in entries"
                        :key="entry.modId"
                        class="sync-log-entry"
                        :class="`sync-log-entry--${entry.status}`"
                    >
                        <span class="sync-log-icon">
                            <CheckIcon v-if="entry.status === 'synced'" />
                            <WarningIcon v-else-if="entry.status === 'failed'" />
                            <UnlinkIcon v-else-if="entry.status === 'unsynced'" />
                            <MinusIcon v-else />
                        </span>

                        <span class="sync-log-copy">
                            <strong :title="entry.directoryName">
                                {{ entry.directoryName }}
                            </strong>
                            <small>{{ entry.message }}</small>
                        </span>

                        <span class="sync-log-result">
                            {{ statusLabel(entry.status) }}
                        </span>
                    </li>
                </ul>
            </section>

            <footer class="sync-progress-footer">
                <div class="sync-log-legend" aria-label="Synchronization status legend">
                    <span class="sync-log-entry--synced">
                        <span class="sync-log-icon"><CheckIcon /></span>
                        Synchronized
                    </span>
                    <span class="sync-log-entry--failed">
                        <span class="sync-log-icon"><WarningIcon /></span>
                        Failed
                    </span>
                    <span class="sync-log-entry--unsynced">
                        <span class="sync-log-icon"><UnlinkIcon /></span>
                        Unsynchronized
                    </span>
                    <span class="sync-log-entry--unchanged">
                        <span class="sync-log-icon"><MinusIcon /></span>
                        No changes
                    </span>
                </div>

                <button
                    type="button"
                    :disabled="busy"
                    @click="requestClose"
                >
                    {{ busy ? "Synchronizing…" : "Done" }}
                </button>
            </footer>
        </div>
    </dialog>
</template>

<style scoped>
.sync-progress-dialog {
    width: min(820px, calc(100vw - 32px));
    height: min(720px, calc(100vh - 32px));
    margin: auto;
    padding: 0;
    overflow: hidden;
    border: 1px solid #383d39;
    border-radius: 12px;
    color: #e4e0d7;
    background: #0e110f;
    box-shadow: 0 22px 60px rgb(0 0 0 / 50%);
}

.sync-progress-dialog::backdrop {
    background: rgb(0 0 0 / 72%);
}

.sync-progress-layout {
    display: grid;
    height: 100%;
    grid-template-rows: auto minmax(0, 1fr) auto;
}

.sync-progress-header {
    padding: 24px 26px 20px;
    border-bottom: 1px solid #292e2b;
}

.sync-progress-label {
    margin: 0 0 5px;
    color: #91b8cf;
    font-size: 12px;
    font-weight: 700;
}

.sync-progress-header h2 {
    margin: 0;
    color: #f2eee5;
    font-size: 23px;
}

.sync-progress-status {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 18px;
    margin-top: 20px;
}

.sync-progress-status > div {
    min-width: 0;
}

.sync-progress-status strong,
.sync-progress-status span {
    display: block;
}

.sync-progress-status strong {
    color: #ddd9d0;
    font-size: 13px;
}

.sync-progress-status span {
    overflow: hidden;
    margin-top: 3px;
    color: #91968f;
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.sync-progress-status > strong {
    flex: 0 0 auto;
    color: #9bc2d9;
}

.sync-progress-track {
    height: 7px;
    margin-top: 10px;
    overflow: hidden;
    border-radius: 999px;
    background: #222724;
}

.sync-progress-fill {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: #86aec7;
    transition: width 180ms ease;
}

.sync-log {
    min-height: 0;
    padding: 20px 26px;
    overflow-y: auto;
}

.sync-log-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
}

.sync-log-heading h3 {
    margin: 0;
    color: #dedad1;
    font-size: 15px;
}

.sync-log-heading span {
    color: #858b84;
    font-size: 12px;
}

.sync-log-empty {
    display: grid;
    min-height: 180px;
    place-items: center;
    margin: 0;
    color: #858a84;
    font-size: 13px;
}

.sync-log ul {
    display: grid;
    gap: 7px;
    margin: 0;
    padding: 0;
    list-style: none;
}

.sync-log-entry {
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr) auto;
    align-items: center;
    gap: 11px;
    min-height: 58px;
    padding: 8px 12px;
    border-radius: 8px;
    background: #131714;
}

.sync-log-icon {
    display: inline-flex;
    width: 28px;
    height: 28px;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    color: #929892;
    background: #202522;
}

.sync-log-icon :deep(svg) {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.9;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.sync-log-entry--synced .sync-log-icon {
    color: #a9d5e9;
    background: #192d36;
}

.sync-log-entry--failed .sync-log-icon {
    color: #e9b079;
    background: #342519;
}

.sync-log-entry--unsynced .sync-log-icon {
    color: #d5b0aa;
    background: #2d201e;
}

.sync-log-copy {
    min-width: 0;
}

.sync-log-copy strong,
.sync-log-copy small {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.sync-log-copy strong {
    color: #e4e0d7;
    font-size: 13px;
}

.sync-log-copy small {
    margin-top: 3px;
    color: #8f958e;
    font-size: 11px;
}

.sync-log-result {
    color: #929892;
    font-size: 11px;
    font-weight: 650;
}

.sync-log-entry--synced .sync-log-result {
    color: #9bc8dc;
}

.sync-log-entry--failed .sync-log-result {
    color: #dfa36e;
}

.sync-log-entry--unsynced .sync-log-result {
    color: #caa19c;
}

.sync-progress-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    padding: 15px 26px;
    border-top: 1px solid #292e2b;
    background: #101310;
}

.sync-log-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 16px;
}

.sync-log-legend > span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: #969b95;
    font-size: 11px;
}

.sync-log-legend .sync-log-icon {
    width: 22px;
    height: 22px;
}

.sync-log-legend .sync-log-icon :deep(svg) {
    width: 13px;
    height: 13px;
}

.sync-progress-footer > button {
    min-width: 82px;
    min-height: 40px;
    padding: 0 15px;
    border: 0;
    border-radius: 7px;
    color: #172027;
    background: #86aec7;
    font: inherit;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
}

.sync-progress-footer > button:hover:not(:disabled) {
    background: #9bbfd5;
}

.sync-progress-footer > button:disabled {
    color: #777c77;
    background: #1c201d;
    cursor: wait;
}

.sync-progress-footer > button:focus-visible {
    outline: 2px solid #f2eee5;
    outline-offset: 2px;
}

@media (max-width: 640px) {
    .sync-progress-header,
    .sync-log {
        padding-right: 18px;
        padding-left: 18px;
    }

    .sync-progress-footer {
        align-items: stretch;
        flex-direction: column;
        padding-right: 18px;
        padding-left: 18px;
    }

    .sync-progress-footer > button {
        width: 100%;
    }

    .sync-log-entry {
        grid-template-columns: 34px minmax(0, 1fr);
    }

    .sync-log-result {
        grid-column: 2;
    }
}

@media (prefers-reduced-motion: reduce) {
    .sync-progress-fill {
        transition: none;
    }
}
</style>
