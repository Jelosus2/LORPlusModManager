import type { UpdateComponent } from "../../shared/updates.js";

export type CheckedUpdateVersions = Readonly<{
    installedVersion: string;
    latestVersion: string;
    required: boolean;
}>;

export interface UpdateChecker {
    readonly component: UpdateComponent;
    check(): Promise<CheckedUpdateVersions>;
}
