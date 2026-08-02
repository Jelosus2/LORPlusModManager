import { UserFacingError } from "./ErrorUtils.js";
import { TypeCheck } from "./TypeCheck.js";

export class VersionUtils {
    private static readonly VERSION_PATTERN = /^(0|[1-9]\d*)(?:\.(0|[1-9]\d*)){1,3}$/;

    static validate(value: unknown, description = "version"): string {
        if (!TypeCheck.isValidString(value, 32) || !VersionUtils.VERSION_PATTERN.test(value))
            throw new UserFacingError(`The ${description} is invalid.`);

        const segments = value.split(".");

        for (const segment of segments)
        {
            const numericValue = Number(segment);

            if (!TypeCheck.isValidInteger(numericValue, true, true))
                throw new UserFacingError(`The ${description} is invalid.`);
        }

        return value;
    }

    static compare(left: string, right: string): number {
        VersionUtils.validate(left, "left version");
        VersionUtils.validate(right, "right version");

        const leftParts = left.split(".").map(Number);
        const rightParts = right.split(".").map(Number);
        const length = Math.max(leftParts.length, rightParts.length);

        for (let i = 0; i < length; i++)
        {
            const difference = (leftParts[i] ?? 0) - (rightParts[i] ?? 0);

            if (difference !== 0)
                return difference < 0 ? -1 : 1;
        }

        return 0;
    }

    static isNewer(candidateVersion: string, installedVersion: string): boolean {
        return VersionUtils.compare(candidateVersion, installedVersion) > 0;
    }
}
