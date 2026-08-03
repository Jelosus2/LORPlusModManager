import { UserFacingError } from "./ErrorUtils.js";

export class HttpDownloadUtils {
    static async readLimitedBody(response: Response, maximumBytes: number, tooLargeMessage: string, emptyMessage: string): Promise<Buffer> {
        const contentLength = response.headers.get("content-length");
        if (contentLength !== null)
        {
            const declaredSize = Number(contentLength);
            if (Number.isFinite(declaredSize) && declaredSize > maximumBytes)
                throw new UserFacingError(tooLargeMessage);
        }

        if (!response.body)
            throw new UserFacingError(emptyMessage);

        const reader = response.body.getReader();
        const chunks: Buffer[] = [];
        let totalBytes = 0;

        try
        {
            while (true)
            {
                const { done, value } = await reader.read();

                if (done)
                    break;

                totalBytes += value.byteLength;
                if (totalBytes > maximumBytes)
                {
                    try
                    {
                        await reader.cancel();
                    }
                    catch
                    {}

                    throw new UserFacingError(tooLargeMessage);
                }

                chunks.push(Buffer.from(value));
            }
        }
        finally
        {
            reader.releaseLock();
        }

        return Buffer.concat(chunks, totalBytes);
    }
}
