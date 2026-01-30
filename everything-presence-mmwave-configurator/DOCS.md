# Everything Presence Add-on: Zone Configurator

[![Stars][stars-shield]][repo]  [![Release][release-shield]][release] [![Discord][discord-shield]][discord]

[**📚 Click here for the most up to date documentation on the Zone Configurator.**][zone-configurator-docs]

## Installation

Use this installation method **ONLY** if you have a [Home Assistant OS Installation][ha-install-docs], if you have another installation type that does not support [Add-ons][ha-addons-docs], you should use the [standalone Docker (`DOCS-DOCKER.md`)][zc-repo-standalone-docs].

1. Click the Home Assistant My button below to open the add-on on your Home
   Assistant instance.

    [![Open your Home Assistant instance and show the dashboard of an add-on.][ha-addon-svg]][ha-addon-url]

   - If that link doesn't work, then...

        1. Go to **`http://homeassistant.local:8123/hassio/store`** (or whatever your Home Assistant URL is).

        1. Click the 3 dots icon in the upper right, then click **`Repository`**.

        1. In the Add field, paste **`https://github.com/EverythingSmartHome/everything-presence-addons`**.

        1. Click **`+ Add`** then **`Close`**.

1. Scroll to the section **"Everything Presence Add-ons"**

1. Click **"Everything Presence Zone Configurator"** and then Install.

1. Start the **Everything Presence Zone Configurator** add-on.

1. Check the logs of the **Everything Presence Zone Configurator** add-on to see if everything started correctly.

1. Click the **OPEN WEB UI** button to open **Everything Presence Zone Configurator**.

## Configuration

### Options

- **port:** This is the port used to reach the web interface.

- **firmware_lan_port:** This is the port used for device OTA updates.

## Next Steps

[**Setup Wizard**][za-setup-wizard] - Configure your first device.

## Quick Links

| I want to...              | Go to...
| :-------------------------| :-
| Install the add-on        | [Installation][installation]
| Set up my first device    | [Setup Wizard][setup-wizard]
| Create detection zones    | [Zone Editor][zone-editor]
| Draw my room layout       | [Room Builder][room-builder]
| Fix a problem             | [Troubleshooting][troubleshooting]
| Update device firmware    | [Firmware Updates][firmware-updates]

<!--
###########################
### Markdown Page Links ###
###########################
-->

<!-- shields.io -->

[stars-shield]: https://img.shields.io/github/stars/EverythingSmartHome/everything-presence-addons
[repo]: https://github.com/EverythingSmartHome/everything-presence-addons

[discord-shield]: https://img.shields.io/discord/719115387425521704.svg
[discord]: https://discord.gg/Bgfvy2f

[release-shield]: https://img.shields.io/github/v/release/EverythingSmartHome/everything-presence-addons.svg
[release]: https://github.com/EverythingSmartHome/everything-presence-addons/releases

<!-- Zone Configurator Documentation -->

[zone-configurator-docs]: https://docs.everythingsmart.io/s/products/doc/zone-configurator-93b9scGsa2
[zc-repo-standalone-docs]: DOCS-DOCKER.md
[za-setup-wizard]: https://docs.everythingsmart.io/s/products/doc/12eba20b-11c3-4451-a484-69636ea2b213

<!-- Home Assistant Links -->

[ha-addon-svg]: https://my.home-assistant.io/badges/supervisor_addon.svg
[ha-addon-url]: https://my.home-assistant.io/redirect/supervisor_addon/?addon=234db91b_everything-presence-zone-configurator&repository_url=https%3A%2F%2Fgithub.com%2FEverythingSmartHome%2Feverything-presence-addons

[ha-install-docs]: https://www.home-assistant.io/installation/
[ha-addons-docs]: https://www.home-assistant.io/addons/

<!-- Zone Configurator Documentation Quick Links -->
[installation]: https://docs.everythingsmart.io/s/products/doc/27058e80-a358-4e3c-9138-2f91af17692e
[setup-wizard]: https://docs.everythingsmart.io/s/products/doc/12eba20b-11c3-4451-a484-69636ea2b213
[zone-editor]: https://docs.everythingsmart.io/s/products/doc/66bbf380-ac1f-408e-a58b-c878f72783f7
[room-builder]: https://docs.everythingsmart.io/s/products/doc/dae67af3-d87c-4acb-ba3f-4f85a802d40f
[troubleshooting]: https://docs.everythingsmart.io/s/products/doc/d34e8813-0a6d-4dff-b0cc-fdc6f66d779f
[firmware-updates]: https://docs.everythingsmart.io/s/products/doc/b41ec504-1d01-4825-af71-4f94527c4f9b
