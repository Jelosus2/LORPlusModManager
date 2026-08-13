import { Readable } from "node:stream";
import path from "node:path";
import fse from "fs-extra";

export type LocalFileResponseOptions = Readonly<{
    size: number;
    contentType?: string;
    cacheControl?: string;
    etag?: string;
}>;

export class LocalFileResponse {
    static create(filePath: string, options: LocalFileResponseOptions): Response {
        const stream = fse.createReadStream(filePath);
        const body = Readable.toWeb(stream);
        const headers = new Headers();

        headers.set("Content-Type", options.contentType ?? this.getContentType(filePath));
        headers.set("Content-Length", String(options.size));

        if (options.cacheControl)
            headers.set("Cache-Control", options.cacheControl);

        if (options.etag)
            headers.set("ETag", `"${options.etag}"`);

        return new Response(body, {
            status: 200,
            headers
        });
    }

    private static getContentType(filePath: string): string {
        switch (path.extname(filePath).toLocaleLowerCase("en-US")) {
            case ".png":
                return "image/png";
            case ".webp":
                return "image/webp";
            case ".json":
                return "application/json; charset=utf-8";
            case ".atlas":
            case ".txt":
                return "text/plain; charset=utf-8";
            default:
                return "application/octet-stream";
        }
    }
}
