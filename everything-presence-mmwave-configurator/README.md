# Everything Presence Add-on: Zone Configurator

[![Stars][stars-shield]][repo]  [![Release][release-shield]][release] [![Discord][discord-shield]][discord]

---

[Zone Configurator][zone-configurator] is a Home Assistant add-on that provides a visual interface for configuring Everything Presence devices. Draw room layouts, create detection zones, and watch real-time target tracking - all from your browser.

![Zone Configurator Frontend][screenshot]

## Key Features

| Feature                                       | Description
| :-------------------------------------------- | :-
| [**Live Dashboard**][live-dashboard]          | Watch targets move in real-time with radar visualization
| [**Room Builder**][room-builder]              | Draw room outlines, add walls, doors, and furniture
| [**Zone Editor**][polygon-zones]              | Create rectangular or polygon detection zones
| [**Entry/Exit Detection**][in-out-detection]  | Track when people enter or leave specific areas
| [**Heatmap Analytics**][heatmap-analytics]    | Visualize presence patterns over time
| [**Recording**][trail-recording]              | Capture movement trails for analysis
| **Firmware Updates**                          | Update devices via a local proxy with progress tracking

## Supported Devices

| Device                                    | Features
| :---------------------------------------- | :-
| [**Everything Presence Pro (EPP)**][epp]  | Full zone support, multi-target tracking, entry/exit zones
| [**Everything Presence Lite (EPL)**][epl] | Full zone support, multi-target tracking, entry/exit zones
| [**Everything Presence One (EP1)**][ep1]  | Environmental monitoring, distance visualization

> [!NOTE]
> The Pro and Lite both use the LD2450 tracking sensor, so they have identical zone and tracking capabilities in the Zone Configurator.

## Requirements

- Home Assistant (with Supervisor for add-on, or Docker for standalone)
- Everything Presence Pro, Lite, or One device
- Device already configured and connected to Home Assistant

## What's New in Version 2

Version 2.0 is a complete rewrite with a modern interface and powerful new features:

- [**Polygon zones**][polygon-zones] - Create complex zone shapes beyond rectangles
- [**Entry/Exit detection**][in-out-detection] - Know when someone enters or leaves a zone
- [**Room Builder**][room-builder] - Visual room layout with furniture and doors
- [**Heatmap analytics**][heatmap-analytics] - See where presence is detected most often
- [**Trail recording**][trail-recording] - Visualize movement paths for debugging and analysis
- **Multi-device support** - Manage all your sensors from one place

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

<!-- ESH Product Links -->

[epl]: https://shop.everythingsmart.io/products/everything-presence-lite
[ep1]: https://shop.everythingsmart.io/products/everything-presence-one-kit
[epp]: https://shop.everythingsmart.io/products/everything-presence-pro

<!-- Zone Configurator Links -->

[zone-configurator]: https://docs.everythingsmart.io/s/products/doc/zone-configurator-93b9scGsa2

[screenshot]: https://docs.everythingsmart.io/api/files.get?sig=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJrZXkiOiJ1cGxvYWRzL2U1MTYzNjNkLThhMWItNDI0Zi1hOTk5LTI0ZDFmMDUxZDNhZi9hNWQ1MjRhOS0zOTdkLTRkYzUtYTFhOS04NDYwMDAwMWEzYmMvaW1hZ2UucG5nIiwidHlwZSI6ImF0dGFjaG1lbnQiLCJpYXQiOjE3Njk3MjczMDcsImV4cCI6MTc2OTczMDkwN30.x5Iep4E7HaVU3Tr9NX1Y3QofN4qEdHhk6n2mt6aCbtA

[live-dashboard]: https://docs.everythingsmart.io/s/products/doc/live-dashboard-BuSQUoDfT8
[room-builder]: https://docs.everythingsmart.io/s/products/doc/66bbf380-ac1f-408e-a58b-c878f72783f7
[polygon-zones]: https://docs.everythingsmart.io/s/products/doc/27058e80-a358-4e3c-9138-2f91af17692e
[in-out-detection]: https://docs.everythingsmart.io/s/products/doc/12eba20b-11c3-4451-a484-69636ea2b213
[heatmap-analytics]: https://docs.everythingsmart.io/s/products/doc/dae67af3-d87c-4acb-ba3f-4f85a802d40f
[trail-recording]: https://docs.everythingsmart.io/s/products/doc/d34e8813-0a6d-4dff-b0cc-fdc6f66d779f
