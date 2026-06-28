### Overview

This is a plugin for installing marketplace packages, which can download and install specified marketplace package GitHub repository releases into SiYuan Notes.

### Features

- Support downloading Release versions from GitHub repositories or marketplace PR URLs
- Display marketplace package info (repo summary, Release info, file size)
- File validation and integrity checks
- Support configuring GitHub Token (encrypted storage) to avoid API rate limits
- Support installing plugins, themes, icons, widgets, templates and toggling them on or off after installation
- Output logs in the tab during installation; abortable at any time
- Quick access to Plugins, Petal, Themes, Icons, Widgets, Templates directories, or open developer tools and plugin settings (Desktop version only)

### Usage

1. Click the download icon in the top toolbar to open the install tab
2. Enter a marketplace PR URL or GitHub repository URL (format: `https://github.com/user/repo`, `user/repo`, or `https://github.com/siyuan-note/bazaar/pull/xxxx`)
3. Pick a Git Tag from the version dropdown (defaults to latest, with search support)
4. Choose whether to enable the package after installation
5. Click "Install package" to start downloading; click "Abort installation" during the process to cancel
6. Use the bottom toolbar to quickly open the directories above, or developer tools and plugin settings (Desktop version only)

### Notes

- Parsing and installation progress is shown in the "Logs" area within the tab; check it first when issues arise
- When hitting GitHub API rate limits, configure a GitHub Token in the plugin settings
