import type { UpdateComponent, UpdateReleaseInfo } from "../../shared/updates.js";

export type CheckedUpdateVersions = Readonly<{
    installedVersion: string;
    latestVersion: string;
    release?: UpdateReleaseInfo;
}>;

export interface UpdateChecker {
    readonly component: UpdateComponent;
    check(): Promise<CheckedUpdateVersions>;
}
