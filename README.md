# Simple Temporary Containers

Create temporary containers with one click.  Temporary containers are removed
when their last tab is closed.

Create temporary containers in any of several ways:
* By clicking the extension's icon in the navigation bar.
* By right-clicking on a link and selecting "Open Link in New Temp Container Tab".
* By right-clicking on a tab in the tab bar and selecting "Reopen in New Temp Container".
* By pressing Ctrl+Alt+C. (Keybindings can be customized in about:addons -> settings dropdown -> Manage Extension Shortcuts.)

To make a temporary container permanent, change its name (e.g. using Preferences -> Tabs -> Settings or Firefox Multi-Account Containers).

Requires no major permissions, and only minimal minor permissions:
* "contextualIdentities": Required in order to create and remove containers.
* "cookies": Required in order to open tabs in containers, and to notice when a temporary container is empty.
* "menus": Required to add the "Open Link in New Temp Container Tab" and "Reopen Tab in New Temp Container" menu items.

Roadmap:
- [ ] Change build process to allow npm to manage mocha, chai dependencies.
- [ ] Run unit tests in node and integration tests in e.g. selenium.
- [ ] Add an optional delay before removing empty temporary containers.
- [x] Add theme icons
- [x] Prevent container names from repeating on reinstall
- [x] Prevent new temp containers from using confusing colors
