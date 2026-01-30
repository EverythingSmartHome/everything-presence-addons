# Everything Presence Add-ons

[![Stars][stars-shield]][repo]  [![Release][release-shield]][release] [![Discord][discord-shield]][discord]

## About

Home Assistant add-ons for Everything Presence One/Lite/Pro mmWave presence sensors.

## Install Repository

Use this installation method **ONLY** if you have a [Home Assistant OS Installation][ha-install-docs], if you have another installation type that does not support [Add-ons][ha-addons-docs], you should use the standalone Dockers.

1. Click the Home Assistant My button below to open the add-on on your Home Assistant instance and click **`Add`**.
  
    [![Open your Home Assistant instance and show the add-on store.][ha-addon-repo-svg]][ha-addon-repo-url]

   - If that link doesn't work, then...

        1. Go to **`http://homeassistant.local:8123/hassio/store`** (or whatever your Home Assistant URL is).

        1. Click the 3 dots icon in the upper right, then click **`Repository`**.

        1. In the Add field, paste **`https://github.com/EverythingSmartHome/everything-presence-addons`**.

        1. Click **`+ Add`** then **`Close`**.

1. Scroll to the section **`"Everything Presence Add-ons"`**.

1. Install any of the **`Add-ons`** in this repository.

## Add-ons provided by this repository

### Everything Presence Zone Configurator

A visual configuration tool for Everything Presence devices in Home Assistant.

**[📚 Zone Configurator Add-on documentation:][zc-repo-addon-docs]** Use for Home Assistant OS Installations

**[📚 Zone Configurator Standalone Docker Documentation][zc-repo-standalone-docs]** Use for Home Assistant Installations that **DO NOT** support add-ons.

**[📚 Zone Configurator Full Documentation][zone-configurator-docs]** Use for general setup and configuration instructions.

---

### Everything Smart Home Documentation

For more information about Everything Presence devices, visit [Everything Smart Home](https://docs.everythingsmart.io)

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

<!-- Home Assistant Links -->

[ha-addon-repo-svg]: https://my.home-assistant.io/badges/supervisor_store.svg
[ha-addon-repo-url]: https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https://github.com/EverythingSmartHome/everything-presence-addons

[ha-install-docs]: https://www.home-assistant.io/installation/
[ha-addons-docs]: https://www.home-assistant.io/addons/

<!-- Zone Configurator Links -->

[zc-repo-standalone-docs]: everything-presence-mmwave-configurator/DOCS-DOCKER.md
[zc-repo-addon-docs]: everything-presence-mmwave-configurator/DOCS.md
[zone-configurator-docs]: https://docs.everythingsmart.io/s/products/doc/zone-configurator-93b9scGsa2
