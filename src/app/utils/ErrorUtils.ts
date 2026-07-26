import { TypeCheck } from "./TypeCheck.js";

export class ErrorUtils {
    static getFsErrorMessage(error: unknown): string {
        if (!TypeCheck.isNodeError(error))
            return "";

        switch (error.code)
        {
            case "EBUSY":
                return "There's something keeping the file open.";
            case "ENOENT":
                return "The file could not be found.";
            case "EACCES":
                return "Permission denied.";
            default:
                return "";
        }
    }
}
