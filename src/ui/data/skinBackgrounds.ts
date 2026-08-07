const backgroundModules = import.meta.glob(
    "../assets/skin_backgrounds/*.webp",
    {
        eager: true,
        query: "?url",
        import: "default"
    }
) as Record<string, string>;

const backgroundUrls = new Map<string, string>();

for (const [modulePath, url] of Object.entries(backgroundModules))
{
    const fileName = modulePath.slice(modulePath.lastIndexOf("/") + 1);
    backgroundUrls.set(fileName.toLowerCase(), url);
}

export function getSkinBackgroundUrl(backgroundFile: string | null): string | undefined {
    if (
        !backgroundFile ||
        backgroundFile !== backgroundFile.trim() ||
        backgroundFile === "." ||
        backgroundFile === ".." ||
        /[\\/\u0000]/.test(backgroundFile) ||
        !backgroundFile.toLowerCase().endsWith(".webp")
    ) {
        return undefined;
    }

    const bundledBackground = backgroundUrls.get(backgroundFile.toLowerCase());
    if (bundledBackground)
        return bundledBackground;

    return `lorplus-catalog-background://catalog/${encodeURIComponent(backgroundFile)}`;
}
