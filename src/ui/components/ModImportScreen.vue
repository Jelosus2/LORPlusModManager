<script setup lang="ts">
import type { ModImportIssueKind, SelectedModSource, ModExtractionResult, ModImportProgress } from "../../shared/mod.ts";

import WarningIcon from "./icons/WarningIcon.vue";
import CheckIcon from "./icons/CheckIcon.vue";

import { useCharacterCatalogStore } from "@/stores/characterCatalogStore";
import { getCharacterIconUrl } from "@/data/characterIcons";
import { computed } from "vue";

const props = defineProps<{
    busy: boolean;
    result: ModExtractionResult | null;
    sources: SelectedModSource[];
    progress: ModImportProgress | null;
}>();

defineEmits<{
    done: [];
    retry: [];
    chooseAgain: [];
}>();

const characterCatalog = useCharacterCatalogStore();

const issues = computed(() => props.result?.issues ?? []);
const sourceCount = computed(() => props.sources.length);
const displayedProgress = computed(() => Math.min(100, Math.max(0, Math.round(props.progress?.progress ?? 0))));
const importedAssetCount = computed(() => props.result?.mods.reduce((total, mod) => total + mod.assetCount, 0) ?? 0);
const progressIsIndeterminate = computed(() => props.progress?.indeterminate === true);
const characterIcons = computed(() => {
    const icons = new Map<string, string>();

    for (const skin of characterCatalog.skins)
    {
        const iconUrl = getCharacterIconUrl(skin.iconFile);
        if (iconUrl)
            icons.set(skin.skin2dId, iconUrl);
    }

    return icons;
});

function issueLabel(kind: ModImportIssueKind): string {
    switch (kind)
    {
        case "incomplete":
            return "Missing assets";
        case "ambiguous":
            return "Ambiguous match";
        case "unrecognized":
            return "Not recognized";
        case "invalid":
            return "Invalid archive";
        case "session":
            return "Session expired";
        default:
            return "Extraction failed";
    }
}
</script>

<template>
    <section class="import-screen" aria-labelledby="import-screen-title">
        <header class="screen-header">
            <div>
                <p class="screen-label">Library · Import</p>
                <h1 id="import-screen-title">
                    {{ busy ? "Importing mods" : "Import results" }}
                </h1>
            </div>

            <button
                v-if="!busy"
                class="header-button"
                type="button"
                @click="$emit('done')"
            >
                Back to mods
            </button>
        </header>

        <div
            v-if="busy"
            class="processing-panel"
            role="status"
            aria-live="polite"
        >
            <div class="processing-heading">
                <div>
                    <h2>
                        {{ progress?.status ?? "Preparing import" }}
                    </h2>
                    <p>
                        {{
                            progress?.detail ??
                            `Preparing ${sourceCount} ${sourceCount === 1 ? "file" : "files"}`
                        }}
                    </p>
                </div>

                <strong>
                    {{
                        progressIsIndeterminate
                            ? "Working…"
                            : `${displayedProgress}%`
                    }}
                </strong>
            </div>

            <div
                class="import-progress-track"
                :class="{
                    'import-progress-track--indeterminate':
                        progressIsIndeterminate
                }"
                role="progressbar"
                aria-label="Mod import progress"
                aria-valuemin="0"
                aria-valuemax="100"
                :aria-valuenow="
                    progressIsIndeterminate
                        ? undefined
                        : displayedProgress
                "
                :aria-valuetext="progress?.status ?? 'Preparing import'"
            >
                <span
                    class="import-progress-fill"
                    :style="
                        progressIsIndeterminate
                            ? undefined
                            : { width: `${displayedProgress}%` }
                    "
                ></span>
            </div>

            <p class="processing-note">
                Keep the app open until the import finishes.
            </p>
        </div>

        <template v-else-if="result">
            <section
                class="result-summary"
                :class="{ 'result-summary--failed': !result.success }"
                aria-live="polite"
            >
                <span class="summary-icon" aria-hidden="true">
                    <CheckIcon v-if="result.success" />
                    <WarningIcon v-else />
                </span>

                <div>
                    <h2>
                        {{
                            result.success
                                ? `${result.mods.length} ${result.mods.length === 1 ? "mod" : "mods"} imported`
                                : "Some files need attention"
                        }}
                    </h2>
                    <p v-if="!result.success">{{ result.message }}</p>

                    <span v-if="result.mods.length > 0" class="summary-detail">
                        {{ importedAssetCount }}
                        {{ importedAssetCount === 1 ? "asset" : "assets" }} extracted
                    </span>
                </div>
            </section>

            <div
                class="result-details"
                :class="{
                    'result-details--mods-only':
                        result.success &&
                        issues.length === 0 &&
                        result.warnings.length === 0
                }"
            >
                <section v-if="result.mods.length > 0" class="result-section">
                    <div class="section-heading">
                        <div>
                            <h2>Imported mods</h2>
                        </div>

                        <span>{{ result.mods.length }}</span>
                    </div>

                    <div class="mod-grid">
                        <article
                            v-for="mod in result.mods"
                            :key="`${mod.sourceName}-${mod.skin2dId}`"
                            class="mod-card"
                        >
                            <span class="card-character-icon" aria-hidden="true">
                                <img
                                    v-if="characterIcons.get(mod.skin2dId)"
                                    :src="characterIcons.get(mod.skin2dId)"
                                    alt=""
                                />
                                <CheckIcon v-else />
                            </span>

                            <div class="card-copy">
                                <strong :title="`${mod.characterName}: ${mod.skinName}`">
                                    {{ mod.characterName }}: {{ mod.skinName }}
                                </strong>
                                <small :title="mod.sourceName">{{ mod.sourceName }}</small>
                            </div>

                            <span class="asset-count">
                                {{ mod.assetCount }}
                                {{ mod.assetCount === 1 ? "asset" : "assets" }}
                            </span>
                        </article>
                    </div>
                </section>

                <section
                    v-if="issues.length > 0 || (!result.success && result.mods.length === 0)"
                    class="result-section"
                >
                    <div class="section-heading">
                        <div>
                            <h2>Files not imported</h2>
                        </div>

                        <span>{{ Math.max(issues.length, 1) }}</span>
                    </div>

                    <div v-if="issues.length > 0" class="issue-list">
                        <article
                            v-for="(issue, issueIndex) in issues"
                            :key="`${issue.sourceId ?? issue.sourceName}-${issueIndex}`"
                            class="issue-card"
                        >
                            <div class="issue-heading">
                                <span class="issue-icon" aria-hidden="true">
                                    <WarningIcon />
                                </span>

                                <div>
                                    <strong :title="issue.sourceName">
                                        {{ issue.sourceName }}
                                    </strong>
                                    <span>{{ issueLabel(issue.kind) }}</span>
                                </div>
                            </div>

                            <p>{{ issue.message }}</p>

                            <div
                                v-for="candidate in issue.candidates"
                                :key="candidate.skin2dId"
                                class="candidate"
                            >
                                <strong
                                    :title="`${candidate.characterName}: ${candidate.skinName}`"
                                >
                                    {{ candidate.characterName }}: {{ candidate.skinName }}
                                </strong>

                                <div
                                    v-if="candidate.missingAssets.length > 0"
                                    class="asset-group"
                                >
                                    <span>Missing</span>
                                    <div>
                                        <code
                                            v-for="asset in candidate.missingAssets"
                                            :key="asset"
                                            :title="asset"
                                        >
                                            {{ asset }}
                                        </code>
                                    </div>
                                </div>

                                <div
                                    v-if="candidate.foundAssets.length > 0"
                                    class="asset-group asset-group--found"
                                >
                                    <span>Found</span>
                                    <div>
                                        <code
                                            v-for="asset in candidate.foundAssets"
                                            :key="asset"
                                            :title="asset"
                                        >
                                            {{ asset }}
                                        </code>
                                    </div>
                                </div>
                            </div>
                        </article>
                    </div>

                    <article v-else class="issue-card issue-card--generic">
                        <div class="issue-heading">
                            <span class="issue-icon" aria-hidden="true">
                                <WarningIcon />
                            </span>

                            <div>
                                <strong>Import failed</strong>
                                <span>Extraction failed</span>
                            </div>
                        </div>

                        <p>{{ result.message }}</p>
                    </article>
                </section>

                <section v-if="result.warnings.length > 0" class="warnings">
                    <h2>Warnings</h2>
                    <ul>
                        <li v-for="warning in result.warnings" :key="warning">
                            {{ warning }}
                        </li>
                    </ul>
                </section>

                <footer class="screen-actions">
                    <template v-if="result.success">
                        <button class="primary-button" type="button" @click="$emit('done')">
                            Back to mods
                        </button>
                    </template>

                    <template v-else>
                        <button
                            class="secondary-button"
                            type="button"
                            @click="$emit('chooseAgain')"
                        >
                            Choose files again
                        </button>

                        <button class="primary-button" type="button" @click="$emit('retry')">
                            Retry import
                        </button>
                    </template>
                </footer>
            </div>
        </template>
    </section>
</template>

<style scoped>
.import-screen {
    display: flex;
    min-width: 0;
    min-height: 0;
    flex: 1;
    flex-direction: column;
    overflow: hidden;
}

.screen-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 24px;
    padding-bottom: 28px;
    border-bottom: 1px solid #292e2b;
}

.screen-label {
    margin: 0 0 6px;
    color: #9bc2d9;
    font-size: 13px;
    font-weight: 650;
}

.screen-header h1 {
    margin: 0;
    color: #f2eee5;
    font-family: "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif;
    font-size: clamp(34px, 4vw, 44px);
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.1;
}

.header-button,
.primary-button,
.secondary-button {
    min-height: 42px;
    padding: 0 17px;
    border: 0;
    border-radius: 7px;
    font: inherit;
    font-size: 13px;
    font-weight: 650;
    cursor: pointer;
}

.header-button,
.secondary-button {
    color: #d8d4cb;
    background: #1a1e1b;
}

.header-button:hover,
.secondary-button:hover {
    background: #222723;
}

.primary-button {
    color: #172027;
    background: #86aec7;
}

.primary-button:hover {
    background: #9bbfd5;
}

.header-button:focus-visible,
.primary-button:focus-visible,
.secondary-button:focus-visible {
    outline: 2px solid #f2eee5;
    outline-offset: 2px;
}

.processing-panel,
.result-summary {
    margin-top: 28px;
    padding: 22px;
    border-radius: 10px;
    background: #111513;
}

.processing-panel {
    display: grid;
    gap: 15px;
}

.result-summary {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 18px;
}

.result-details {
    min-height: 0;
    flex: 1;
    margin-top: 24px;
    padding-right: 10px;
    overflow-y: auto;
    overscroll-behavior: contain;
}

.result-details > .result-section:first-child {
    margin-top: 0;
}

.result-details--mods-only {
    display: flex;
    padding-right: 0;
    overflow: hidden;
    flex-direction: column;
}

.result-details--mods-only > .result-section {
    display: flex;
    min-height: 0;
    flex: 1;
    flex-direction: column;
}

.result-details--mods-only .mod-grid {
    min-height: 0;
    flex: 1;
    align-content: start;
    grid-auto-rows: max-content;
    padding-right: 10px;
    overflow-y: auto;
    overscroll-behavior: contain;
}

.result-details--mods-only .screen-actions {
    display: none;
}

.processing-heading {
    display: flex;
    min-width: 0;
    align-items: flex-start;
    justify-content: space-between;
    gap: 24px;
}

.processing-heading > div {
    min-width: 0;
}

.processing-heading > strong {
    flex: 0 0 auto;
    color: #b9d7e8;
    font-size: 17px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
}

.processing-panel h2,
.result-summary h2 {
    margin: 0;
    color: #ece8df;
    font-size: 19px;
    font-weight: 680;
}

.processing-panel p,
.result-summary p {
    margin: 6px 0 0;
    color: #a5aaa4;
    font-size: 15px;
    line-height: 1.55;
}

.import-progress-track {
    width: 100%;
    height: 8px;
    overflow: hidden;
    border-radius: 999px;
    background: #252b28;
}

.import-progress-fill {
    display: block;
    width: 0;
    height: 100%;
    border-radius: inherit;
    background: #86aec7;
    transition: width 180ms ease-out;
}

.import-progress-track--indeterminate .import-progress-fill {
    width: 35%;
    animation: import-progress-indeterminate 1.1s ease-in-out infinite;
}

@keyframes import-progress-indeterminate {
    from {
        transform: translateX(-120%);
    }

    to {
        transform: translateX(320%);
    }
}

.processing-panel .processing-note {
    margin: -2px 0 0;
    color: #7f857f;
    font-size: 13px;
}

.summary-icon,
.issue-icon {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    color: #a7ccdf;
    background: #1a282f;
}

.summary-icon {
    width: 42px;
    height: 42px;
    border-radius: 50%;
}

.summary-icon svg {
    width: 23px;
    height: 23px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 2;
}

.result-summary--failed .summary-icon,
.issue-icon {
    color: #e2b184;
    background: #2a211a;
}

.result-summary--failed .summary-icon svg,
.issue-icon svg {
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.8;
}

.summary-detail {
    display: inline-block;
    margin-top: 7px;
    color: #809088;
    font-size: 14px;
    font-weight: 650;
}

.result-section {
    margin-top: 34px;
}

.section-heading {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 20px;
    margin-bottom: 13px;
}

.section-heading h2,
.warnings h2 {
    margin: 0;
    color: #e8e4db;
    font-size: 20px;
    font-weight: 680;
}

.section-heading > span {
    color: #858b85;
    font-size: 13px;
}

.mod-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 9px;
}

.mod-card {
    display: grid;
    min-width: 0;
    grid-template-columns: 48px minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    padding: 15px;
    border-radius: 9px;
    background: #111513;
}

.card-character-icon {
    display: inline-flex;
    width: 48px;
    height: 48px;
    overflow: hidden;
    align-items: center;
    justify-content: center;
    border-radius: 7px;
    color: #a7ccdf;
    background: #1a282f;
}

.card-character-icon img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.card-character-icon svg {
    width: 17px;
    height: 17px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 2;
}

.card-copy {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 3px;
}

.card-copy strong,
.card-copy small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.card-copy strong {
    color: #e8e4db;
    font-size: 14px;
    font-weight: 650;
}

.card-copy small {
    color: #7f857f;
    font-size: 12px;
}

.asset-count {
    color: #9aa09a;
    font-size: 12px;
    white-space: nowrap;
}

.issue-list {
    display: grid;
    gap: 10px;
}

.issue-card {
    min-width: 0;
    padding: 17px;
    border-radius: 9px;
    background: #121311;
}

.issue-heading {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 12px;
}

.issue-icon {
    width: 34px;
    height: 34px;
    border-radius: 8px;
}

.issue-icon svg {
    width: 19px;
    height: 19px;
}

.issue-heading > div {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 2px;
}

.issue-heading strong {
    overflow: hidden;
    color: #e7e2d9;
    font-size: 14px;
    font-weight: 650;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.issue-heading span {
    color: #bf9875;
    font-size: 12px;
}

.issue-card > p {
    margin: 13px 0 0 46px;
    color: #a1a59f;
    font-size: 13px;
    line-height: 1.5;
}

.candidate {
    display: grid;
    gap: 10px;
    margin: 14px 0 0 46px;
    padding: 13px;
    border-radius: 7px;
    background: #0d100e;
}

.candidate > strong {
    overflow: hidden;
    color: #d9d5cc;
    font-size: 13px;
    font-weight: 650;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.asset-group {
    display: grid;
    gap: 6px;
}

.asset-group > span {
    color: #c79770;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
}

.asset-group > div {
    display: flex;
    min-width: 0;
    flex-wrap: wrap;
    gap: 5px;
}

.asset-group code {
    max-width: 100%;
    overflow: hidden;
    padding: 4px 7px;
    border-radius: 4px;
    color: #c6aaa0;
    background: #211815;
    font-family: "Cascadia Mono", Consolas, monospace;
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.asset-group--found > span {
    color: #7fa89a;
}

.asset-group--found code {
    color: #9eb8ae;
    background: #14201b;
}

.warnings {
    margin-top: 24px;
    padding: 16px 18px;
    border-radius: 8px;
    background: #141512;
}

.warnings h2 {
    font-size: 15px;
}

.warnings ul {
    display: grid;
    gap: 5px;
    margin: 9px 0 0;
    padding-left: 20px;
    color: #aaa99f;
    font-size: 13px;
}

.screen-actions {
    display: flex;
    justify-content: flex-end;
    gap: 9px;
    margin-top: 32px;
    padding-top: 22px;
    border-top: 1px solid #292e2b;
}

@media (max-width: 820px) {
    .mod-grid {
        grid-template-columns: minmax(0, 1fr);
    }
}

@media (max-width: 520px) {
    .screen-header {
        align-items: stretch;
        flex-direction: column;
    }

    .header-button {
        align-self: flex-start;
    }

    .mod-card {
        grid-template-columns: 48px minmax(0, 1fr);
    }

    .asset-count {
        grid-column: 2;
    }

    .issue-card > p,
    .candidate {
        margin-left: 0;
    }

    .screen-actions {
        align-items: stretch;
        flex-direction: column-reverse;
    }
}

@media (prefers-reduced-motion: reduce) {
    .import-progress-fill {
        transition: none;
    }

    .import-progress-track--indeterminate .import-progress-fill {
        width: 100%;
        opacity: 0.55;
        animation: none;
    }
}
</style>
