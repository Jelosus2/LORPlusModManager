<p align="center">
  <img src="src/ui/assets/app-icon.png" width="126" height="126" alt="LORPlusModManager icon">
</p>

<h1 align="center">LORPlusModManager</h1>

<p align="center">
  <a href="https://github.com/Jelosus2/LORPlusModManager/releases/latest">
    <img alt="Latest release" src="https://img.shields.io/github/v/release/Jelosus2/LORPlusModManager?display_name=tag&sort=semver&style=flat-square">
  </a>
  <a href="https://github.com/Jelosus2/LORPlusModManager/releases">
    <img alt="Total downloads" src="https://img.shields.io/github/downloads/Jelosus2/LORPlusModManager/total?style=flat-square&label=downloads">
  </a>
  <a href="https://github.com/Jelosus2/LORPlusModManager/actions/workflows/release.yml">
    <img alt="Release workflow" src="https://img.shields.io/github/actions/workflow/status/Jelosus2/LORPlusModManager/release.yml?style=flat-square&label=release">
  </a>
  <img alt="Windows 10 and 11" src="https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0078D4?style=flat-square&logo=windows&logoColor=white">
  <a href="https://github.com/Jelosus2/LORPlusModManager/blob/main/LICENSE">
    <img alt="MIT license" src="https://img.shields.io/github/license/Jelosus2/LORPlusModManager?style=flat-square">
  </a>
  <a href="https://discord.gg/8bdGg9rz6r">
    <img alt="Last Origin Modding Center Discord" src="https://img.shields.io/badge/Discord-Modding%20Center-5865F2?style=flat-square&logo=discord&logoColor=white">
  </a>
</p>

> A Windows mod manager for Last Origin R+.

LORPlusModManager installs the required game integration, imports and organizes character mods, synchronizes selected mods with the game, and provides interactive previews for supported skins.

## 🚀 Features

- Automatic Last Origin R+ location detection.
- Automatic BepInEx and LOPlugin+ installation and updates.
- Single-file and batch mod imports.
- ZIP and Unity asset bundle support.
- Password-protected ZIP support.
- Automatic character and skin matching.
- Static, Spine, and Animator mod previews.
- Character catalog with mod counts and filtering.
- Mod conflict and missing-file detection.
- Copy and symbolic-link synchronization.
- LOPlugin+ configuration editor.
- Application, plugin, and character catalog updates.
- Integrated logs and storage maintenance.
- Modded and vanilla game launch options.

## 📋 Requirements

- Windows 10/11, 64-bit.
- Last Origin R+ (Obviously).
- [LOLauncher 1.0.5 or later](https://github.com/Jelosus2/LOLauncher/releases) to use the built-in game launch buttons.

**Note:** LOLauncher is optional if you start the game separately.

## 📦 Installation

1. Download and install the latest installer from the [Releases](https://github.com/Jelosus2/LORPlusModManager/releases) page.
3. Select or automatically detect your Last Origin R+ installation.
4. Allow the setup process to install BepInEx and LOPlugin+.
5. Import mods and select the ones you want to synchronize.

## 📥 Importing mods

LORPlusModManager accepts:

- ZIP archives (can contain Unity asset bundles inside the ZIP).
- Unity asset bundles.
- Multiple files in a single batch.

ZIP archives are limited to:

- 20,000 entries.
- 1 GB per individual entry.
- 2 GB total extracted content.

Imported mods are stored in the application data directory. They are only placed in the game directory after synchronization.

## 🔄 Synchronization methods

### 📁 Copy

Copies selected mod files into the game directory.

- Does not require administrator privileges.
- Uses additional disk space.
- Works well with other file-management tools.

### 🔗 Symbolic link

Links the game directory to the imported mod library.

- Uses little additional disk space.
- Synchronizes large libraries faster.
- Requires administrator privileges.
- Depends on the original imported mod files remaining available.

## ❓ All cool, but, where do I get mods?

You can find mods in the [Last Origin Modding Center](https://discord.gg/8bdGg9rz6r) discord server.

## 📷 Screenshots

### Mods Screen
![mods screen](./.github/images/mods_screen.png)

### Characters Screen
![characters screen](./.github/images/characters_screen.png)

### Settings Screen
![settings screen](./.github/images/settings_screen.png)

### Plugin Configuration Screen
![plugin configuration screen](./.github/images/plugin_config_screen.png)

### Mod Preview Screen
![mod preview screen](./.github/images/mod_preview_screen.png)

## ❤️ Support

If you find the mod manager useful and want to support the development, you can do so here:

- KoFi: https://ko-fi.com/jelosus1

## ⚠️ Disclaimer

LORPlusModManager is an independent, unofficial project.

This project is not affiliated with, endorsed by, sponsored by, or approved by Valofe or any related company. Last Origin R+, VFUN, and related names, logos, and assets are property of their respective owners.