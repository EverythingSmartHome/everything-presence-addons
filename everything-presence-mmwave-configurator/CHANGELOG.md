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
