export type GameLauncherRequirement = "install" | "update";

export type GameLaunchRequest = Readonly<{
    vanilla: boolean;
}>;

export type GameLaunchResult =
    | Readonly<{
        status: "started";
    }>
    | Readonly<{
        status: "launcher-required";
        requirement: GameLauncherRequirement;
        minimumVersion: string;
    }>;
