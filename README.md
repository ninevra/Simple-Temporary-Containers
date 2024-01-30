# Simple Temporary Containers

Isolate websites in temporary containers. Uses just the minimum permissions and stores no data.

## What are containers?

Containers group tabs into isolated contexts, each with its own separate [cookies and website data](https://wiki.mozilla.org/Security/Contextual_Identity_Project/Containers#What_is_.28and_isn.27t.29_separated_between_Containers). Tabs in one container can't see cookies from any other container. That lets you sign in to an account in one container and use a different account or stay signed out in another, and makes it harder (though not impossible) to track you across containers.

## What are temporary containers?

This extension makes it easy to create temporary containers, which start out blank with no cookies or saved website data, and are automatically removed when you close all their tabs.

## Using temporary containers

You can create temporary containers in several ways:
* By clicking the extension's icon in the navigation bar.
* By right-clicking on a link and selecting "Open Link in New Temp Container Tab".
* By right-clicking on a tab in the tab bar and selecting "Reopen in New Temp Container".
* By pressing `Ctrl+Alt+C`. (Keybindings can be customized in `about:addons` -> settings dropdown -> Manage Extension Shortcuts.)
* By creating a container called `%NEW_TEMP_CONTAINER%`. (This is mostly useful for [integrating with other extensions](#using-simple-temorary-containers-with-other-extensions) that create containers.)

To make a temporary container permanent, change its name (for example by visiting `about:preferences#containers` or using Firefox Multi-Account Containers).

## Privacy

Uses **no** major permissions (permissions that [show warnings](https://extensionworkshop.com/documentation/develop/request-the-right-permissions/#advised-permissions) to users and are listed on [addons.mozilla.org](https://addons.mozilla.org)).

Uses only the minimum minor permissions:
* `"contextualIdentities"`: Allows the extension to create and remove containers.
* `"cookies"`: Allows the extension to create tabs in containers and to see what container each tab is in.
* `"menus"`: Allows the extension to add items to context (right-click) menus.
These minor permissions are granted automatically by the browser and require no user input.

No user data is stored or sent anywhere.

## Using Simple Temorary Containers with other extensions

### [Firefox Multi-Account Containers](https://addons.mozilla.org/en-US/firefox/addon/multi-account-containers/) by Mozilla

Provides a convenient interface for listing, creating, and modifying containers. It's helpful for renaming temporary containers to make them persistent.

However, Simple Temporary Containers is not currently compatible with its "Container Sync" feature, so be sure to leave that feature disabled.

### [New container tab](https://addons.mozilla.org/en-US/firefox/addon/new-container-tab/) by [Jonathan Kingston](https://addons.mozilla.org/en-US/firefox/user/12818933/)

Provides a keyboard shortcut for opening a new tab in the same container as the current tab. It's helpful for opening multiple pages in the same temporary container.

### [Open external links in a container](https://addons.mozilla.org/en-US/firefox/addon/open-url-in-container/) by [Denys H](https://addons.mozilla.org/en-US/firefox/user/15243938/)

Provides a means of opening links from the command line or from other applications in the container of your choice. Use `%NEW_TEMP_CONTAINER%` to open links in temporary containers:

```sh
firefox "ext+container:name=%NEW_TEMP_CONTAINER%&url=https://mozilla.org/"
```

Thanks to [Maxim Baz](https://github.com/maximbaz) for this feature!

## Prior art

[Temporary Containers](https://addons.mozilla.org/en-US/firefox/addon/temporary-containers/) by [stoically](https://addons.mozilla.org/en-US/firefox/user/13470938/) is another wonderful extension serving the same purpose. [Temporary Containers](https://addons.mozilla.org/en-US/firefox/addon/temporary-containers/) offers much more functionality at the cost of more complexity and many more permissions. My goal with Simple Temporary Containers is to provide the basic functionality with as few permissions as possible and, hopefully, easily-auditable code.

## Roadmap

- [ ] Make this compatible with Containers Sync.
- [ ] Add a build process to allow npm to manage mocha, chai dependencies.
- [ ] Run unit tests in node and integration tests in e.g. selenium.
- [ ] Add an optional delay before removing empty temporary containers.
- [x] Add theme icons
- [x] Prevent container names from repeating on reinstall
- [x] Prevent new temp containers from using confusing colors
