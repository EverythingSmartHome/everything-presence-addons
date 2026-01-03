## 2.0.7
* Clarify installation steps in README.md by @gregschwartz in https://github.com/EverythingSmartHome/everything-presence-addons/pull/177
* Cleanup Javascript Repo Setup  by @ndom91 in https://github.com/EverythingSmartHome/everything-presence-addons/pull/119
* Show when entities are disabled during discovery by @EverythingSmartHome in https://github.com/EverythingSmartHome/everything-presence-addons/pull/181
* Handle unavailable/unknown entity states consistently by @EverythingSmartHome in https://github.com/EverythingSmartHome/everything-presence-addons/pull/182
* Fix issue with trigger distance overlay not enabling by @EverythingSmartHome in https://github.com/EverythingSmartHome/everything-presence-addons/pull/183
* Improve displaying of installation angle and rotation angle in UI and live dashboard by @EverythingSmartHome in https://github.com/EverythingSmartHome/everything-presence-addons/pull/184
* Add auto suggestion of installation angle when rotating UI by @EverythingSmartHome in https://github.com/EverythingSmartHome/everything-presence-addons/pull/187
* Feature: Set default room by @EverythingSmartHome in https://github.com/EverythingSmartHome/everything-presence-addons/pull/188
* Improve loading of rooms initially by @EverythingSmartHome in https://github.com/EverythingSmartHome/everything-presence-addons/pull/189
* Fix issue where no devices would show up to be added by @EverythingSmartHome in https://github.com/EverythingSmartHome/everything-presence-addons/pull/190
* Improve re-connecting of WS by @EverythingSmartHome in https://github.com/EverythingSmartHome/everything-presence-addons/pull/194
* Support installing on arm by @EverythingSmartHome in https://github.com/EverythingSmartHome/everything-presence-addons/pull/195
* Add more builds by @EverythingSmartHome in https://github.com/EverythingSmartHome/everything-presence-addons/pull/199

## 2.0.6
This release adds quite a bit of work to discovering entities, which in turn resolves a lot of the UI issues like settings not showing up, missing sensors, tracking not updating real-time. Recommend re-syncing entities after by going to Settings > Re-Sync entities. Make sure that the auto discovered entities are matched correctly and change any that have not.

- Fix deleted zones not saving to device by @EverythingSmartHome in https://github.com/EverythingSmartHome/everything-presence-addons/pull/149
- Fix regular zone saving as entry zones (Rectangular zone mode) by @EverythingSmartHome in https://github.com/EverythingSmartHome/everything-presence-addons/pull/160
- Show Home Assistant area and firmware version during setup by @EverythingSmartHome in https://github.com/EverythingSmartHome/everything-presence-addons/pull/161
- Store device version in device profile by @EverythingSmartHome in https://github.com/EverythingSmartHome/everything-presence-addons/pull/162
- Improve entity discovery and matching by @EverythingSmartHome in https://github.com/EverythingSmartHome/everything-presence-addons/pull/163
- Improve displaying of units of measurement by @EverythingSmartHome in https://github.com/EverythingSmartHome/everything-presence-addons/pull/165
- Fix issue with re-appearing re-sync entities message constantly by @EverythingSmartHome in https://github.com/EverythingSmartHome/everything-presence-addons/pull/166

## 2.0.5

- Fix zone deletion not working in Zone Editor by [@EverythingSmartHome](https://github.com/EverythingSmartHome)
- Fix false "firmware update needed" warning for entry zones when in polygon mode by [@EverythingSmartHome](https://github.com/EverythingSmartHome)
- Fix scrolling in furniture catalog causing canvas to zoom by [@EverythingSmartHome](https://github.com/EverythingSmartHome)
- Improve furniture catalog UI - convert to modal popup with fixed height by [@EverythingSmartHome](https://github.com/EverythingSmartHome)
- Fix room management always showing "0 zones configured" by [@EverythingSmartHome](https://github.com/EverythingSmartHome)

## 2.0.4
- Fix issue where zooming would get constantly reset by [@EverythingSmartHome](https://github.com/EverythingSmartHome)
- Improve saving of zones by [@EverythingSmartHome](https://github.com/EverythingSmartHome)
- Improve page load times by [@EverythingSmartHome](https://github.com/EverythingSmartHome)
- Fix 502 errors on opening of live dashboard by [@EverythingSmartHome](https://github.com/EverythingSmartHome)

## 2.0.3
- Refactor to separate device entity mappings from room configs, making device mappings the single source of truth stored at the device level by [@EverythingSmartHome](https://github.com/EverythingSmartHome)

## 2.0.2

- Fix issue where entities were not correctly discovered during setup. by [@EverythingSmartHome](https://github.com/EverythingSmartHome)
- Create UI flow during setup to correctly discover entities and allow user to re-map them by [@EverythingSmartHome](https://github.com/EverythingSmartHome)
- Create UI flow in settings to re-sync devices that have already been added by [@EverythingSmartHome](https://github.com/EverythingSmartHome)

## 2.0.0 - Complete Rewrite

Version 2.0 is a complete rewrite of the Zone Configurator with a new modern UI and significantly expanded functionality by [@EverythingSmartHome](https://github.com/EverythingSmartHome).

### Added
- **New UI** - Completely redesigned interface built with React and Tailwind CSS by @EverythingSmartHome
- **Polygon Zone Support** - Create custom-shaped zones beyond simple rectangles by @EverythingSmartHome
- **Entry Zone Support** - Define entry/exit zones for directional presence detection by @EverythingSmartHome
- **Assumed Presence Mode** - Configure assumed presence behavior for more reliable detection by @EverythingSmartHome
- **Recording** - Record and playback target tracking data for analysis by @EverythingSmartHome
- **Room Builder** - Design room layouts with walls, doors, and furniture for accurate zone placement by @EverythingSmartHome
- **Multi-device Support** - Manage multiple Everything Presence devices from a single interface by @EverythingSmartHome
- **Real-time Tracking** - Live visualization of detected targets with coordinate trails by @EverythingSmartHome
- **Heatmap Analytics** - Visualize presence patterns over time by @EverythingSmartHome
- **Environmental Monitoring** - View temperature, humidity, CO2, and illuminance data by @EverythingSmartHome
- **Dark Mode** - Full dark mode support with system auto-detection by @EverythingSmartHome
- **Import/Export** - Save and restore room configurations by @EverythingSmartHome

### Changed
- Backend rewritten in Node.js/TypeScript (previously Python/Flask) by @EverythingSmartHome
- Frontend rewritten in React/TypeScript (previously vanilla JavaScript) by @EverythingSmartHome
- Data storage location changed to `/config/everything-presence-zone-configurator/`

---

## Previous Releases (V1)

### 1.2.2
- Fix: Allow drawing zones at default coordinates without being flagged as existing. @EverythingSmartHome in https://github.com/EverythingSmartHome/everything-presence-addons/pull/86
- Feature: Add delete button to zone side tiles (shown in Edit Mode) to delete user/exclusion zones. @EverythingSmartHome in https://github.com/EverythingSmartHome/everything-presence-addons/pull/87
- Feature: Implement WebSockets for better performance by @EverythingSmartHome in https://github.com/EverythingSmartHome/everything-presence-addons/pull/80
- Feature: Add settings menu to adjust non-zone settings from the UI by @EverythingSmartHome in https://github.com/EverythingSmartHome/everything-presence-addons/pull/83
- Fix: Add sidebar icon by @LarsStegman in https://github.com/EverythingSmartHome/everything-presence-addons/pull/84

### 1.2.1
- Implement zone edit mode @EverythingSmartHome in https://github.com/EverythingSmartHome/everything-presence-addons/pull/77
- Fix zones being longer than max supported size @EverythingSmartHome in https://github.com/EverythingSmartHome/everything-presence-addons/pull/77
- Fix zones saving when outside max dimensions @EverythingSmartHome in https://github.com/EverythingSmartHome/everything-presence-addons/pull/77
- Fix exclusion zones not being deletable @EverythingSmartHome in https://github.com/EverythingSmartHome/everything-presence-addons/pull/77
- Fix zones being deleted if outside max width by @EverythingSmartHome in https://github.com/EverythingSmartHome/everything-presence-addons/pull/77
- Improve mobile responsiveness by @EverythingSmartHome in https://github.com/EverythingSmartHome/everything-presence-addons/pull/78

### 1.2.0
- Add second exclusion zone by @EverythingSmartHome in https://github.com/EverythingSmartHome/everything-presence-addons/pull/68
- Add cleaner and more functional UI by @EverythingSmartHome in https://github.com/EverythingSmartHome/everything-presence-addons/pull/73
- Add styling improvements, animations, tool-tip and improvements to zone displays by @EverythingSmartHome in https://github.com/EverythingSmartHome/everything-presence-addons/pull/74
- Fix not being able to delete exclusion zones by @EverythingSmartHome in https://github.com/EverythingSmartHome/everything-presence-addons/pull/75

### 1.1.4
- Adds support for a second exclusion zone with firmware 1.3.0 of Everything Presence Lite [@EverythingSmartHome](https://github.com/EverythingSmartHome/everything-presence-addons/pull/68)

### 1.1.3
- Added the ability to display devices by their Friendly name to make device selection easier  [OliverHi](https://github.com/OliverHi)

### 1.1.2

- Added Zone Exports UI button & JavaScript to save current zones in map to a JSON file to allow for re-import or backups [@ilikestohack](https://github.com/ilikestohack)
- Added Zone Imports UI button & JavaScript to import the previously saved JSON files [@ilikestohack](https://github.com/ilikestohack)
- Added Zone Reset UI button & JavaScript to reset user zones in current view [@ilikestohack](https://github.com/ilikestohack)
- Fixed issue where right clicking and canceling a deletion would add a new zone by ignoring right clicks in mouse down event - Fixes [#18](https://github.com/EverythingSmartHome/everything-presence-addons/issues/18) [@ilikestohack](https://github.com/ilikestohack)
- Fixed issues where when dragging an item it would break due to the zoneType being pulled as null because you were dragging over the area outside of the zone (Could not get the zone), now there is a type variable that is updated only when the dragging is started [@ilikestohack](https://github.com/ilikestohack)
- Added a button to convert the HA Zones to User Zones that can be saved/repositioned - Fixes [#27](https://github.com/EverythingSmartHome/everything-presence-addons/issues/27) [@ilikestohack](https://github.com/ilikestohack)
- Made sure that when converting HA Zones to User Zones any zone at origin (all 0 coordinates) were ignored so the zone could be added [@ilikestohack](https://github.com/ilikestohack)
- Added this backdated changelog - Fixes [#35](https://github.com/EverythingSmartHome/everything-presence-addons/issues/35) [@ilikestohack](https://github.com/ilikestohack)
- Bumped version to 1.1.2 [@ilikestohack](https://github.com/ilikestohack)

[Github Compare](https://github.com/EverythingSmartHome/everything-presence-addons/compare/1.1.1...1.1.2)

### 1.1.1

- Add support for inches and other units of measurement by [@akarras](https://github.com/akarras) in [#23](https://github.com/EverythingSmartHome/everything-presence-addons/issues/23)
- Implement better searching of entity names [@pugson](https://github.com/pugson) in [#16](https://github.com/EverythingSmartHome/everything-presence-addons/issues/16)
- New Feature: Added Persistence Tracking by [@francismiles1](https://github.com/francismiles1) in [#32](https://github.com/EverythingSmartHome/everything-presence-addons/issues/32)
- Update styles.css - Persistence Button Support by [@francismiles1](https://github.com/francismiles1) in [#33](https://github.com/EverythingSmartHome/everything-presence-addons/issues/33)

[Github Compare](https://github.com/EverythingSmartHome/everything-presence-addons/compare/1.1.0...1.1.1)

### 1.1.0

The main highlight for this release is the addition of Occupancy Masks! Occupancy masks allow you to define a zone to exclude from detecting motion in, for example if you have a fan and you want to exclude it from triggering the sensor.

Make sure the Everything Presence Lite is update to version 1.2.0 or greater.

- Add support for exclusion zones by [@EverythingSmartHome](https://github.com/EverythingSmartHome) in [#9](https://github.com/EverythingSmartHome/everything-presence-addons/issues/9)
- Bump version to 1.1.0 by [@EverythingSmartHome](https://github.com/EverythingSmartHome) in [#10](https://github.com/EverythingSmartHome/everything-presence-addons/issues/10)

[Github Compare](https://github.com/EverythingSmartHome/everything-presence-addons/compare/1.0.3...1.1.0)

### 1.0.3

- Implement Installation Angle by [@MenesesPT](https://github.com/MenesesPT) in [#2](https://github.com/EverythingSmartHome/everything-presence-addons/issues/2)
- Add docker build action by [@EverythingSmartHome](https://github.com/EverythingSmartHome) in [#6](https://github.com/EverythingSmartHome/everything-presence-addons/issues/6)
- Bump version to 1.0.3 by [@EverythingSmartHome](https://github.com/EverythingSmartHome) in [#7](https://github.com/EverythingSmartHome/everything-presence-addons/issues/7)

[Github Compare](https://github.com/EverythingSmartHome/everything-presence-addons/compare/v1.0.2...1.0.3)

### 1.0.2

- Add standalone docker compatibility by [@EverythingSmartHome](https://github.com/EverythingSmartHome) in [#4](https://github.com/EverythingSmartHome/everything-presence-addons/issues/4)
- Bump version to 1.0.2 by [@EverythingSmartHome](https://github.com/EverythingSmartHome) in [#5](https://github.com/EverythingSmartHome/everything-presence-addons/issues/5)

[Github Commit Log](https://github.com/EverythingSmartHome/everything-presence-addons/commits/v1.0.2)
