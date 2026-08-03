const iconModules = import.meta.glob(
    "../assets/character_icons/*.png",
    {
        eager: true,
        query: "?url",
        import: "default"
    }
) as Record<string, string>;

const iconUrls = new Map<string, string>();

for (const [modulePath, url] of Object.entries(iconModules))
{
    const fileName = modulePath.slice(modulePath.lastIndexOf("/") + 1);
    iconUrls.set(fileName.toLowerCase(), url);
}

export function getCharacterIconUrl(iconFile: string): string | undefined {
    const bundledIcon = iconUrls.get(iconFile.toLowerCase());
    if (bundledIcon)
        return bundledIcon;

    if (
        !iconFile ||
        iconFile !== iconFile.trim() ||
        iconFile === "." ||
        iconFile === ".." ||
        /[\\/\u0000]/.test(iconFile) ||
        !iconFile.toLowerCase().endsWith(".png")
    )
    {
        return undefined;
    }

    return `lorplus-catalog-icon://catalog/${encodeURIComponent(iconFile)}`;
}
