import { ApplicationLogger } from "#maintenance/ApplicationLogger.js";
import { ApplicationLogSource } from "../../shared/application.js";
import { UserFacingError } from "./ErrorUtils.js";
import { TypeCheck } from "./TypeCheck.js";

export type GitHubReleaseAsset = Readonly<{
    name: string;
    apiUrl: string;
    downloadUrl: string;
    size: number;
}>;

export type GitHubRelease = Readonly<{
    tagName: string;
    assets: readonly GitHubReleaseAsset[];
}>;

export class GitHubReleaseClient {
    private static readonly MAX_RELEASE_RESPONSE_SIZE = 512 * 1024;
    private static readonly MAX_RELEASE_ASSETS = 15;

    async getLatestRelease(repository: string): Promise<GitHubRelease> {
        if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
            throw new UserFacingError("The GitHub repository name is invalid.");

        const value = await this.requestJson(
            `https://api.github.com/repos/${repository}/releases/latest`,
            `application/vnd.github+json`,
            GitHubReleaseClient.MAX_RELEASE_RESPONSE_SIZE,
            "check the latest GitHub release"
        );

        return this.parseRelease(value);
    }

    findAsset(release: GitHubRelease, fileName: string): GitHubReleaseAsset {
        const asset = release.assets.find((candidate) => candidate.name === fileName);
        if (!asset)
            throw new UserFacingError(`${fileName} is missing from release ${release.tagName}.`);

        return asset;
    }

    async readAssetJson(asset: GitHubReleaseAsset, maximumSize = 64 * 1024): Promise<unknown> {
        if (asset.size > maximumSize)
            throw new UserFacingError(`${asset.name} is unexpectedly large.`);

        return this.requestJson(asset.apiUrl, "application/octet-stream", maximumSize, `download ${asset.name}`);
    }

    private async requestJson(url: string, accept: string, maximumSize: number, action: string): Promise<unknown> {
        const response = await fetch(url, {
            headers: this.createHeaders(accept),
            signal: AbortSignal.timeout(30_000)
        });

        if (!response.ok)
            throw this.createHttpError(response.status, action);

        const declaredLength = Number(response.headers.get("content-length"));
        if (Number.isFinite(declaredLength) && declaredLength > maximumSize)
            throw new UserFacingError("The server response is unexpectedly large.");

        const contents = await response.text();
        if (Buffer.byteLength(contents, "utf-8") > maximumSize)
            throw new UserFacingError("The server response is unexpectedly large.");

        try
        {
            return JSON.parse(contents);
        }
        catch (error)
        {
            ApplicationLogger.error(ApplicationLogSource.application, `Could not parse the GitHub response JSON (${Buffer.byteLength(contents, "utf-8")} bytes).`, error);
            throw new UserFacingError("GitHub returned an invalid JSON.", { cause: error });
        }
    }

    private parseRelease(value: unknown): GitHubRelease {
        if (
            !TypeCheck.isRecord(value) ||
            !TypeCheck.isValidString(value.tag_name, 33) ||
            !TypeCheck.isValidArray(value.assets, GitHubReleaseClient.MAX_RELEASE_ASSETS)
        )
        {
            throw new UserFacingError("GitHub returned invalid release information.");
        }

        const assetNames = new Set<string>();
        const assets = value.assets.map((asset): GitHubReleaseAsset => {
            if (
                !TypeCheck.isRecord(asset) ||
                !TypeCheck.isValidString(asset.name, 255) ||
                !TypeCheck.isValidString(asset.url, 2048) ||
                !TypeCheck.isValidString(asset.browser_download_url, 2048) ||
                !TypeCheck.isValidInteger(asset.size, true)
            )
            {
                throw new UserFacingError("GitHub returned invalid release asset information.");
            }

            if (assetNames.has(asset.name))
                throw new UserFacingError("The GitHub release has duplicate assets.");

            assetNames.add(asset.name);

            this.validateHttpsUrl(asset.url);
            this.validateHttpsUrl(asset.browser_download_url);

            return Object.freeze({
                name: asset.name,
                apiUrl: asset.url,
                downloadUrl: asset.browser_download_url,
                size: asset.size
            });
        });

        return Object.freeze({
            tagName: value.tag_name,
            assets: Object.freeze(assets)
        });
    }

    private createHeaders(accept: string): Record<string, string> {
        const headers: Record<string, string> = {
            Accept: accept,
            "User-Agent": "LORPlusModManager",
            "X-GitHub-Api-Version": "2022-11-28"
        };

        const token = process.env.LORPLUS_GITHUB_TOKEN?.trim();
        if (token)
            headers.Authorization = `Bearer ${token}`;

        return headers;
    }

    private validateHttpsUrl(value: string) {
        let url: URL;

        try
        {
            url = new URL(value);
        }
        catch
        {
            throw new UserFacingError("GitHub returned an invalid asset address.");
        }

        if (url.protocol !== "https:")
            throw new UserFacingError("GitHub returned an unsafe asset address.");
    }

    private createHttpError(status: number, action: string): UserFacingError {
        switch (status)
        {
            case 401:
                return new UserFacingError(`GitHub authentication failed while trying to ${action}.`);
            case 403:
                return new UserFacingError(`GitHub denied the request while trying to ${action}. The API rate limit may have been reached.`);
            case 404:
                return new UserFacingError(`The requested GitHub release or asset could not be found while trying to ${action}.`);
            default:
                return new UserFacingError(`GitHub returned HTTP ${status} while trying to ${action}.`);
        }
    }
}
