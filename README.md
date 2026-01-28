# Everything Presence Add-ons

Home Assistant add-ons for Everything Presence One/Lite/Pro mmWave presence sensors.

## Everything Presence Zone Configurator

A visual configuration tool for Everything Presence devices in Home Assistant.

### Features

- **Real-time Tracking** - Live visualization of detected targets with coordinate tracking (Everything Presence Lite)
- **Visual Zone Editor** - Draw and configure detection zones directly on a room layout
- **Polygon Zones** - Create custom-shaped zones beyond simple rectangles
- **Entry Zones** - Define entry/exit zones for directional presence detection
- **Assumed Presence Mode** - Configure assumed presence behavior for more reliable detection
- **Room Builder** - Design your room layout with walls, doors, and furniture for accurate zone placement
- **Multi-device Support** - Manage multiple Everything Presence devices from a single interface
- **Environmental Monitoring** - View temperature, humidity, CO2, and illuminance data (device dependent)

### Supported Devices

- Everything Presence Lite
- Everything Presence One
- Everything Presence Pro

### Installation

1. [Click this link to add this repository to the Add-on Store](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https://github.com/EverythingSmartHome/everything-presence-addons) (note: not HACS) and click Add.
   - If that link doesn't work, then
        1. Go to http://homeassistant.local:8123/hassio/store (or whatever your Home Assistant URL is)
        2. Click the 3 dots icon in the upper right, then click `Repository`
        3. In the Add field, paste `https://github.com/EverythingSmartHome/everything-presence-addons` 
        4. Click `+ Add` then `Close`
3. Scroll to the section "Everything Presence Add-ons" 
4. Click "Everything Presence Zone Configurator" and then Install
5. Start the add-on and open the web UI

### Standalone Docker

Use the standalone image for non-Home Assistant installs:

```
everythingsmarthome/everything-presence-mmwave-configurator:latest
```

Set `HA_BASE_URL` and `HA_LONG_LIVED_TOKEN` for standalone mode. The `:addon` tag is the Home Assistant add-on base image and requires Supervisor to run.

**Port change (v2.0.11):** The default app port is now `42069`. Existing Docker users can either update their port mapping to `42069:42069` or keep the old behavior by setting `PORT=3000` and continuing to map `3000:3000`.

Example `docker-compose.yaml`:

```yaml
services:
  zone-configurator:
    image: everythingsmarthome/everything-presence-mmwave-configurator:latest
    container_name: everything-presence-mmwave-configurator
    restart: unless-stopped
    ports:
      - "42069:42069"
      - "38080:38080"
    environment:
      HA_BASE_URL: "http://homeassistant.local:8123"
      HA_LONG_LIVED_TOKEN: "REPLACE_WITH_LONG_LIVED_TOKEN"
      FIRMWARE_LAN_PORT: "38080"
    volumes:
      - ./config:/config
```

### LAN Firmware Port

Firmware updates are served over a local HTTP port for ESP devices. By default this uses port `38080`.

- Home Assistant add-on: configure `firmware_lan_port` in the add-on Configuration tab.
- Standalone Docker: set `FIRMWARE_LAN_PORT` and map the same host port.

### Documentation

For more information about Everything Presence devices, visit [Everything Smart Home](https://docs.everythingsmart.io)
