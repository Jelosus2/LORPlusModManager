export class GitHubRequestUtils {
    private static readonly API_HOSTNAME = "api.github.com";

    static createDownloadHeaders(url: URL, defaultAccept: string): Record<string, string> {
        const headers: Record<string, string> = {
            Accept: defaultAccept,
            "User-Agent": "LORPlusModManager"
        };

        if (!this.isGitHubApiUrl(url))
            return headers;

        headers.Accept = "application/vnd.github.raw+json";
        headers["X-GitHub-Api-Version"] = "2026-03-10";

        const token = process.env.LORPLUS_GITHUB_TOKEN?.trim();
        if (token)
            headers.Authorization = `Bearer ${token}`;

        return headers;
    }

    static isGitHubApiUrl(url: URL): boolean {
        return (
            url.protocol === "https:" &&
            url.hostname.toLowerCase() === this.API_HOSTNAME
        );
    }

    static hasToken(): boolean {
        return Boolean(process.env.LORPLUS_GITHUB_TOKEN?.trim());
    }
}
