import type {
    ApplicationUpdateDownloadProgress,
    AutomaticUpdatePreferences,
    ComponentUpdateResult,
    InstalledComponentVersions,
    UpdateCheckMode,
    UpdateComponent
} from "../../shared/updates";
import type { PluginProgress } from "../../shared/plugin";

import { useCharacterCatalogStore } from "./characterCatalogStore";
import { computed, ref, shallowRef } from "vue";
import { ErrorUtils } from "@/utils/ErrorUtils";
import { defineStore } from "pinia";

const DEFAULT_PREFERENCES: AutomaticUpdatePreferences = Object.freeze({
    application: true,
    plugin: true,
    catalog: true
});

const EMPTY_VERSIONS: InstalledComponentVersions = Object.freeze({
    application: null,
    plugin: null,
    catalog: null
});

export const useUpdateStore = defineStore("updates", () => {
    const preferences = ref<AutomaticUpdatePreferences>(DEFAULT_PREFERENCES);
    const installedVersions = ref<InstalledComponentVersions>(EMPTY_VERSIONS);
    const isSettingsLoaded = ref(false);
    const isLoadingSettings = ref(false);
    const isChecking = ref(false);
    const savingPreference = ref<UpdateComponent | null>(null);
    const lastChecked = ref("");
    const errorMessage = ref("");
    const isStartupModalOpen = ref(false);
    const isDownloading = ref(false);
    const isInstalling = ref(false);
    const isUpdateReady = ref(false);
    const downloadProgress = ref<ApplicationUpdateDownloadProgress | null>(null);
    const downloadError = ref("");
    const results = shallowRef<Partial<Record<UpdateComponent, ComponentUpdateResult>>>({});
    const isPluginUpdateModalOpen = ref(false);
    const isUpdatingPlugin = ref(false);
    const isPluginUpdateComplete = ref(false);
    const pluginUpdateProgress = ref<PluginProgress | null>(null);
    const pluginUpdateError = ref("");
    const isCatalogUpdateModalOpen = ref(false);
    const isUpdatingCatalog = ref(false);
    const isCatalogUpdateComplete = ref(false);
    const catalogUpdateError = ref("");

    let loadingPromise: Promise<boolean> | null = null;
    let checkingPromise: Promise<boolean> | null = null;
    let initializationPromise: Promise<void> | null = null;
    let pendingPluginStartupModal = false;
    let pendingCatalogStartupModal = false;
    let initialized = false;

    const applicationResult = computed(() => results.value.application);
    const applicationUpdateAvailable = computed(() => applicationResult.value?.status === "available");
    const applicationUpdateVersion = computed(() => applicationResult.value?.latestVersion ?? null);
    const pluginResult = computed(() => results.value.plugin);
    const pluginUpdateAvailable = computed(() => pluginResult.value?.status === "available");
    const pluginUpdateVersion = computed(() => pluginResult.value?.latestVersion ?? null);
    const catalogResult = computed(() => results.value.catalog);
    const catalogUpdateAvailable = computed(() => catalogResult.value?.status === "available");
    const catalogUpdateVersion = computed(() => catalogResult.value?.latestVersion ?? null);

    async function initialize() {
        if (initialized)
            return;

        initializationPromise ??= (async () => {
            await loadSettings();
            await checkForUpdates("automatic");
            initialized = true;
        })().finally(() => {
            initializationPromise = null;
        });

        return initializationPromise;
    }

    function loadSettings(force = false): Promise<boolean> {
        if (isSettingsLoaded.value && !force)
            return Promise.resolve(true);
        if (loadingPromise)
            return loadingPromise;

        loadingPromise = (async () => {
            isLoadingSettings.value = true;
            errorMessage.value = "";

            try
            {
                const state = await window.app.getUpdateSettings();

                preferences.value = state.preferences;
                installedVersions.value = state.installedVersions;
                lastChecked.value = state.lastChecked ?? "";
                isSettingsLoaded.value = true;

                return true;
            }
            catch (error)
            {
                console.error("Could not load the update settings:", error);

                errorMessage.value = ErrorUtils.getUserErrorMessage(error, "The update settings could not be loaded.");
                return false;
            }
            finally
            {
                isLoadingSettings.value = false;
            }
        })();

        return loadingPromise.finally(() => {
            loadingPromise = null;
        });
    }

    function checkForUpdates(mode: UpdateCheckMode): Promise<boolean> {
        if (checkingPromise)
            return checkingPromise;

        checkingPromise = (async () => {
            isChecking.value = true;
            errorMessage.value = "";

            try
            {
                const result = await window.app.checkForUpdates(mode);
                const nextResults: Partial<Record<UpdateComponent, ComponentUpdateResult>> = {};
                const nextVersions = { ...installedVersions.value };

                for (const componentResult of result.components)
                {
                    nextResults[componentResult.component] = componentResult;

                    if (componentResult.installedVersion)
                        nextVersions[componentResult.component] = componentResult.installedVersion;
                }

                results.value = nextResults;
                installedVersions.value = nextVersions;

                if (result.checkedAt)
                    lastChecked.value = result.checkedAt;

                const application = nextResults.application;

                if (downloadProgress.value && application?.latestVersion !== downloadProgress.value.version)
                {
                    downloadProgress.value = null;
                    isUpdateReady.value = false;
                    downloadError.value = "";
                }

                if (mode === "automatic")
                {
                    const applicationAvailable = application?.status === "available";
                    const pluginAvailable = nextResults.plugin?.status === "available";
                    const catalogAvailable = nextResults.catalog?.status === "available";

                    isStartupModalOpen.value = applicationAvailable;
                    isPluginUpdateModalOpen.value = !applicationAvailable && pluginAvailable;
                    isCatalogUpdateModalOpen.value = !applicationAvailable && !pluginAvailable && catalogAvailable;

                    pendingPluginStartupModal = applicationAvailable && pluginAvailable;
                    pendingCatalogStartupModal = catalogAvailable && (applicationAvailable || pluginAvailable);
                }

                return true;
            }
            catch (error)
            {
                console.error("Could not check for updates:", error);

                errorMessage.value = ErrorUtils.getUserErrorMessage(error, "Updates could not be checked.");
                return false;
            }
            finally
            {
                isChecking.value = false;
            }
        })();

        return checkingPromise.finally(() => {
            checkingPromise = null;
        });
    }

    async function savePreference(component: UpdateComponent, enabled: boolean): Promise<boolean> {
        if (savingPreference.value !== null)
            return false;

        savingPreference.value = component;
        errorMessage.value = "";

        try
        {
            preferences.value = await window.app.setAutomaticUpdatePreference({ component, enabled });
            return true;
        }
        catch (error)
        {
            console.error(`Could not save the ${component} update preference:`, error);

            errorMessage.value = ErrorUtils.getUserErrorMessage(error, "The automatic update preference could not be saved.");
            return false;
        }
        finally
        {
            savingPreference.value = null;
        }
    }

    async function downloadApplicationUpdate(): Promise<boolean> {
        if (isDownloading.value || isUpdateReady.value || !applicationUpdateAvailable.value)
            return false;

        const version = applicationUpdateVersion.value;
        if (!version)
            return false;

        isDownloading.value = true;
        downloadError.value = "";

        downloadProgress.value = {
            phase: "downloading",
            version,
            progress: 0,
            transferredBytes: 0,
            totalBytes: 0,
            bytesPerSecond: 0
        };

        const removeProgressListener = window.app.onApplicationUpdateDownloadProgress((progress) => {
            downloadProgress.value = progress;

            if (progress.phase === "ready")
                isUpdateReady.value = true;
        });

        try
        {
            const result = await window.app.downloadApplicationUpdate();

            isUpdateReady.value = true;
            downloadProgress.value = {
                phase: "ready",
                version: result.version,
                progress: 100,
                transferredBytes: 0,
                totalBytes: 0,
                bytesPerSecond: 0
            };

            return true;
        }
        catch (error)
        {
            console.error("Could not download the application update:", error);

            downloadError.value = ErrorUtils.getUserErrorMessage(error, "The application update could not be downloaded.");
            return false;
        }
        finally
        {
            removeProgressListener();
            isDownloading.value = false;
        }
    }

    async function installApplicationUpdate() {
        if (!isUpdateReady.value || isInstalling.value)
            return;

        isInstalling.value = true;
        downloadError.value = "";

        try
        {
            await window.app.installApplicationUpdate();
        }
        catch (error)
        {
            console.error("Could not install the application update:", error);

            downloadError.value = ErrorUtils.getUserErrorMessage(error, "The application update could not be installed.");
            isInstalling.value = false;
        }
    }

    async function updatePlugin(): Promise<boolean> {
        if (isUpdatingPlugin.value || !pluginUpdateAvailable.value)
            return false;

        const expectedVersion = pluginUpdateVersion.value;
        if (!expectedVersion)
            return false;

        isUpdatingPlugin.value = true;
        isPluginUpdateComplete.value = false;
        pluginUpdateError.value = "";

        pluginUpdateProgress.value = {
            status: "Preparing the LOPlugin+ update…",
            progress: 0,
            downloadedBytes: 0,
            totalBytes: 0
        };

        const removeProgressListener = window.app.onLOPluginInstallProgress((progress) => {
            pluginUpdateProgress.value = progress;
        });

        try
        {
            const result = await window.app.installLOPlugin();
            if (!result.success)
            {
                pluginUpdateError.value = result.message || "LOPlugin+ could not be updated.";
                return false;
            }

            if (!result.version)
            {
                pluginUpdateError.value = "The update completed without reporting the installed LOPlugin+ version.";
                return false;
            }

            setInstalledVersion("plugin", result.version);

            results.value = {
                ...results.value,
                plugin: {
                    component: "plugin",
                    status: "up-to-date",
                    installedVersion: result.version,
                    latestVersion: result.version,
                    message: `LOPlugin+ ${result.version} is installed.`,
                    release: pluginResult.value?.release ?? null
                }
            };

            isPluginUpdateComplete.value = true;
            return true;
        }
        catch (error)
        {
            console.error("Could not update LOPlugin+:", error);

            pluginUpdateError.value = ErrorUtils.getUserErrorMessage(error, "LOPlugin+ could not be updated.");
            return false;
        }
        finally
        {
            removeProgressListener();
            isUpdatingPlugin.value = false;
        }
    }

    async function updateCatalog(): Promise<boolean> {
        if (isUpdatingCatalog.value || !catalogUpdateAvailable.value)
            return false;

        const expectedVersion = catalogUpdateVersion.value;
        if (!expectedVersion)
            return false;

        isUpdatingCatalog.value = true;
        isCatalogUpdateComplete.value = false;
        catalogUpdateError.value = "";

        try
        {
            const installedCatalog = await window.app.updateCharacterCatalog();

            useCharacterCatalogStore().replaceCatalog(installedCatalog);
            setInstalledVersion("catalog", installedCatalog.version);

            results.value = {
                ...results.value,
                catalog: {
                    component: "catalog",
                    status: "up-to-date",
                    installedVersion: installedCatalog.version,
                    latestVersion: installedCatalog.version,
                    message: `Character catalog ${installedCatalog.version} is installed.`,
                    release: null
                }
            };

            isCatalogUpdateComplete.value = true;
            return true;
        }
        catch (error)
        {
            console.error("Could not update the character catalog:", error);

            catalogUpdateError.value = ErrorUtils.getUserErrorMessage(error, "The character catalog could not be updated.");
            return false;
        }
        finally
        {
            isUpdatingCatalog.value = false;
        }
    }

    function setInstalledVersion(component: UpdateComponent, version: string | null) {
        installedVersions.value = {
            ...installedVersions.value,
            [component]: version
        };
    }

    function closeStartupModal(): void {
        isStartupModalOpen.value = false;

        if (pendingPluginStartupModal)
        {
            pendingPluginStartupModal = false;
            isPluginUpdateModalOpen.value = true;
        }
        else if (pendingCatalogStartupModal)
        {
            pendingCatalogStartupModal = false;
            isCatalogUpdateModalOpen.value = true;
        }
    }

    function closePluginUpdateModal(): void {
        if (isUpdatingPlugin.value)
            return;

        isPluginUpdateModalOpen.value = false;
        isPluginUpdateComplete.value = false;
        pluginUpdateProgress.value = null;
        pluginUpdateError.value = "";

        if (pendingCatalogStartupModal)
        {
            pendingCatalogStartupModal = false;
            isCatalogUpdateModalOpen.value = true;
        }
    }

    function closeCatalogUpdateModal(): void {
        if (isUpdatingCatalog.value)
            return;

        isCatalogUpdateModalOpen.value = false;
        isCatalogUpdateComplete.value = false;
        catalogUpdateError.value = "";
    }

    return {
        preferences,
        installedVersions,
        results,
        isLoadingSettings,
        isChecking,
        savingPreference,
        lastChecked,
        errorMessage,
        applicationResult,
        applicationUpdateAvailable,
        isStartupModalOpen,
        isDownloading,
        isInstalling,
        isUpdateReady,
        downloadProgress,
        downloadError,
        pluginResult,
        pluginUpdateAvailable,
        isPluginUpdateModalOpen,
        isUpdatingPlugin,
        isPluginUpdateComplete,
        pluginUpdateProgress,
        pluginUpdateError,
        catalogResult,
        catalogUpdateAvailable,
        isCatalogUpdateModalOpen,
        isUpdatingCatalog,
        isCatalogUpdateComplete,
        catalogUpdateError,
        initialize,
        loadSettings,
        checkForUpdates,
        savePreference,
        downloadApplicationUpdate,
        installApplicationUpdate,
        setInstalledVersion,
        closeStartupModal,
        updatePlugin,
        closePluginUpdateModal,
        updateCatalog,
        closeCatalogUpdateModal
    };
});
