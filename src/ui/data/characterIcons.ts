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
    return iconUrls.get(iconFile.toLowerCase());
}
