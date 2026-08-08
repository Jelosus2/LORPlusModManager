import { TypeCheck } from "#utils/TypeCheck.js";
import { spawn } from "node:child_process";
import { Paths } from "#utils/Paths.js";

export type UnityAssetType = "Texture2D" | "TextAsset";

export type UnityBundleAsset = {
    id: string;
    type: UnityAssetType;
    name: string;
    pathId: string;
    serializedFile: string;
    catalogCandidates: string[];
};

export type UnityBundleInspection = {
    bundleName: string;
    unityPyVersion: string;
    assets: UnityBundleAsset[];
};

export type UnityAssetSelection = {
    id: string;
    outputName: string;
};

export type ExtractedUnityAsset = UnityAssetSelection & {
    size: number;
};

export type UnityBundleExtraction = {
    bundleName: string;
    written: ExtractedUnityAsset[];
};

export type UnityPreviewAssetType = "Texture2D" | "Sprite";

export type UnityPreviewAssetSelection = {
    type: UnityPreviewAssetType;
    name: string;
    outputName: string;
};

export type UnitySpriteGeometry = {
    pixelWidth: number;
    pixelHeight: number;
    pixelsPerUnit: number;
    pivot: {
        x: number;
        y: number;
    };
};

export type ExtractedUnityPreviewAsset = UnityPreviewAssetSelection & {
    size: number;
    sprite?: UnitySpriteGeometry;
};

export type UnityPreviewExtraction = {
    bundleName: string;
    written: ExtractedUnityPreviewAsset[];
};

type WorkerRequest =
    | {
        protocolVersion: number;
        command: "inspect";
        bundlePath: string;
    }
    | {
        protocolVersion: number;
        command: "extract";
        bundlePath: string;
        destination: string;
        assets: UnityAssetSelection[];
    }
    | {
        protocolVersion: number;
        command: "extract-preview";
        bundlePath: string;
        destination: string;
        assets: UnityPreviewAssetSelection[];
    };

export class UnityWorkerError extends Error {
    constructor(
        message: string,
        readonly stderr = ""
    ) {
        super(message);
        this.name = "UnityWorkerError";
    }
}

export class UnityWorkerClient {
    private readonly PROTOCOL_VERSION = 1;
    private readonly INSPECTION_TIMEOUT = 5 * 60 * 1000;
    private readonly EXTRACTION_TIMEOUT = 20 * 60 * 1000;
    private readonly MAX_OUTPUT_BYTES = 20 * 1024 * 1024;

    async inspect(bundlePath: string): Promise<UnityBundleInspection> {
        const response = await this.execute({
            protocolVersion: this.PROTOCOL_VERSION,
            command: "inspect",
            bundlePath
        }, this.INSPECTION_TIMEOUT);

        if (
            !TypeCheck.isValidString(response.bundleName) ||
            !TypeCheck.isValidString(response.unityPyVersion) ||
            !TypeCheck.isValidArray(response.assets) ||
            !response.assets.every((asset) => this.isBundleAsset(asset))
        )
        {
            throw new UnityWorkerError("The Unity worker returned an invalid inspection result.");
        }

        return {
            bundleName: response.bundleName,
            unityPyVersion: response.unityPyVersion,
            assets: response.assets
        };
    }

    async extract(bundlePath: string, destination: string, assets: readonly UnityAssetSelection[]): Promise<UnityBundleExtraction> {
        const response = await this.execute({
            protocolVersion: this.PROTOCOL_VERSION,
            command: "extract",
            bundlePath,
            destination,
            assets: assets.map((asset) => ({ ...asset }))
        }, this.EXTRACTION_TIMEOUT);

        if (
            !TypeCheck.isValidString(response.bundleName) ||
            !TypeCheck.isValidArray(response.written) ||
            !response.written.every((asset) => this.isExtractedAsset(asset))
        )
        {
            throw new UnityWorkerError("The Unity worker returned an invalid extraction result.");
        }

        return {
            bundleName: response.bundleName,
            written: response.written
        };
    }

    async extractPreviewAssets(bundlePath: string, destination: string, assets: readonly UnityPreviewAssetSelection[]): Promise<UnityPreviewExtraction> {
        const response = await this.execute({
            protocolVersion: this.PROTOCOL_VERSION,
            command: "extract-preview",
            bundlePath,
            destination,
            assets: assets.map((asset) => ({ ...asset }))
        }, this.EXTRACTION_TIMEOUT);

        if (
            !TypeCheck.isValidString(response.bundleName) ||
            !TypeCheck.isValidArray(response.written, 64) ||
            !response.written.every((asset) => this.isExtractedPreviewAsset(asset))
        )
        {
            throw new UnityWorkerError("The Unity worker returned an invalid preview extraction result.");
        }

        return {
            bundleName: response.bundleName,
            written: response.written
        };
    }

    private execute(request: WorkerRequest, timeout: number): Promise<Record<string, unknown>> {
        return new Promise((resolve, reject) => {
            const worker = spawn(Paths.getUnityWorkerPath(), [], {
                windowsHide: true,
                shell: false,
                stdio: ["pipe", "pipe", "pipe"]
            });

            let stdout = "";
            let stderr = "";
            let stdoutBytes = 0;
            let stderrBytes = 0;
            let terminationMessage: string | null = null;
            let settled = false;

            const timer = setTimeout(() => {
                terminationMessage = "The Unity worker timed out.";
                worker.kill();
            }, timeout);

            const rejectOnce = (error: Error) => {
                if (settled)
                    return;

                settled = true;
                clearTimeout(timer);
                reject(error);
            };

            worker.stdout.setEncoding("utf-8");
            worker.stderr.setEncoding("utf-8");

            worker.stdout.on("data", (chunk: string) => {
                stdoutBytes += Buffer.byteLength(chunk);

                if (stdoutBytes > this.MAX_OUTPUT_BYTES)
                {
                    terminationMessage = "The Unity worker produced too much output.";
                    worker.kill();
                    return;
                }

                stdout += chunk;
            });

            worker.stderr.on("data", (chunk: string) => {
                stderrBytes += Buffer.byteLength(chunk);

                if (stderrBytes > this.MAX_OUTPUT_BYTES)
                {
                    terminationMessage = "The Unity worker produced too much error output.";
                    worker.kill();
                    return;
                }

                stderr += chunk;
            });

            worker.once("error", (error) => {
                rejectOnce(new UnityWorkerError("The Unity worker could not be started.", error.message));
            });

            worker.once("close", (exitCode) => {
                if (settled)
                    return;

                settled = true;
                clearTimeout(timer);

                if (terminationMessage)
                {
                    reject(new UnityWorkerError(terminationMessage, stderr.trim()));
                    return;
                }

                let response: unknown;

                try
                {
                    response = JSON.parse(stdout.trim());
                }
                catch
                {
                    reject(new UnityWorkerError("The Unity worker returned an invalid response.", stderr.trim()));
                    return;
                }

                if (!TypeCheck.isRecord(response) || response.protocolVersion !== this.PROTOCOL_VERSION || !TypeCheck.isBoolean(response.success))
                {
                    reject(new UnityWorkerError("The Unity worker returned an unsupported response.", stderr.trim()));
                    return;
                }

                if (!response.success)
                {
                    const message = TypeCheck.isValidString(response.message)
                        ? response.message
                        : "The Unity worker failed.";

                    reject(new UnityWorkerError(message, stderr.trim()));
                    return;
                }

                if (exitCode !== 0)
                {
                    reject(new UnityWorkerError(`The Unity worker exited with code ${exitCode}.`, stderr.trim()));
                    return;
                }

                resolve(response);
            });

            worker.stdin.on("error", () => undefined);
            worker.stdin.end(JSON.stringify(request), "utf-8");
        });
    }

    private isBundleAsset(value: unknown): value is UnityBundleAsset {
        return (
            TypeCheck.isRecord(value) &&
            TypeCheck.isValidString(value.id) &&
            (value.type === "Texture2D" || value.type === "TextAsset") &&
            TypeCheck.isValidString(value.name) &&
            TypeCheck.isValidString(value.pathId) &&
            TypeCheck.isValidString(value.serializedFile) &&
            TypeCheck.isValidArray(value.catalogCandidates) &&
            value.catalogCandidates.every((candidate) => TypeCheck.isValidString(candidate))
        );
    }

    private isExtractedAsset(value: unknown): value is ExtractedUnityAsset {
        return (
            TypeCheck.isRecord(value) &&
            TypeCheck.isValidString(value.id) &&
            TypeCheck.isValidString(value.outputName) &&
            TypeCheck.isValidInteger(value.size, true)
        );
    }

    private isExtractedPreviewAsset(value: unknown): value is ExtractedUnityPreviewAsset {
        if (
            !TypeCheck.isRecord(value) ||
            (value.type !== "Texture2D" && value.type !== "Sprite") ||
            !TypeCheck.isValidString(value.name) ||
            !TypeCheck.isValidString(value.outputName) ||
            !TypeCheck.isValidInteger(value.size, true)
        )
        {
            return false;
        }

        if (value.type === "Sprite")
            return this.isSpriteGeometry(value.sprite);

        return value.sprite === undefined;
    }

    private isSpriteGeometry(value: unknown): value is UnitySpriteGeometry {
        return (
            TypeCheck.isRecord(value) &&
            TypeCheck.isValidInteger(value.pixelWidth, true) &&
            value.pixelWidth > 0 &&
            TypeCheck.isValidInteger(value.pixelHeight, true) &&
            value.pixelHeight > 0 &&
            this.isFiniteNumber(value.pixelsPerUnit) &&
            value.pixelsPerUnit > 0 &&
            TypeCheck.isRecord(value.pivot) &&
            this.isFiniteNumber(value.pivot.x) &&
            this.isFiniteNumber(value.pivot.y)
        );
    }

    private isFiniteNumber(value: unknown): value is number {
        return typeof value === "number" && Number.isFinite(value);
    }
}
