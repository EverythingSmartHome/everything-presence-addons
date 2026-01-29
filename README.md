# Everything Presence Add-ons

Home Assistant add-ons for Everything Presence One/Lite/Pro mmWave presence sensors.

## Everything Presence Zone Configurator

A visual configuration tool for Everything Presence devices in Home Assistant.

### Documentation

For additional documentation about this software visit the [**Everything Smart Home Zone Configurator Documentation**](https://docs.everythingsmart.io/s/products/doc/zone-configurator-93b9scGsa2).

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

- [Everything Presence Lite](https://shop.everythingsmart.io/products/everything-presence-lite)
- [Everything Presence One](https://shop.everythingsmart.io/products/everything-presence-one-kit)
- [Everything Presence Pro](https://shop.everythingsmart.io/products/everything-presence-pro)

---

### Home Assistant OS Add-on

Use this installation method **ONLY** if you have a [Home Assistant OS Installation](https://www.home-assistant.io/installation/), if you have another installation type that does not support [Add-ons](https://www.home-assistant.io/addons/), you should use the [standalone Docker](#standalone-docker).

1. [Click this link to add this repository to the Add-on Store](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https://github.com/EverythingSmartHome/everything-presence-addons) (note: not HACS) and click **Add**.

   - If that link doesn't work, then...

        1. Go to http://homeassistant.local:8123/hassio/store (or whatever your Home Assistant URL is).

        1. Click the 3 dots icon in the upper right, then click **`Repository`**.

        1. In the Add field, paste **`https://github.com/EverythingSmartHome/everything-presence-addons`**.

        1. Click **`+ Add`** then **`Close`**.

1. Scroll to the section **"Everything Presence Add-ons"**.

1. Click **"Everything Presence Zone Configurator"** and then **Install**.

1. Start the add-on and open the web UI.

---

### Standalone Docker

Use this installation method if your Home Assistant installation does **NOT** support [Add-ons](https://www.home-assistant.io/addons/), or you just want to run the Everything Presence Zone Configurator outside of your Home Assistant install.

### Standalone Docker Image

All of the deployment methods below use following the [`latest`](https://hub.docker.com/r/everythingsmarthome/everything-presence-mmwave-configurator/tags?name=latest) standalone image for non-Home Assistant OS installs:

```yaml
everythingsmarthome/everything-presence-mmwave-configurator:latest
```

**NOTE:** The [`:addon`](https://hub.docker.com/r/everythingsmarthome/everything-presence-mmwave-configurator/tags?name=addon) tag is the [Home Assistant Add-on](#home-assistant-os-add-on) base image and **requires** Supervisor to run.

### Zone Configurator Ports

**_Resources:_** [Publishing & Exposing Ports in Docker](https://docs.docker.com/get-started/docker-concepts/running-containers/publishing-ports/)

**App Port:** Port `42069` is exposed for the web interface.

- **Port change (v2.0.11):** Existing Docker users can either update their port mapping to **`42069:42069`** or keep the old behavior by setting **`APP_PORT=3000`** and continuing to map **`3000:3000`**.

**LAN Firmware Port:** Firmware updates are served over a local HTTP port for ESP devices. By default this uses port **`38080`**.

- Home Assistant add-on: configure **`firmware_lan_port`** in the add-on **Configuration tab**.
- Standalone Docker: set **`FIRMWARE_LAN_PORT`** and **map the same host port and docker port**.

### Deployment

#### 1. Create a Long Lived Token

In order for this software to communicate with your Home Assistant installation, you **MUST** create a Long Lived Token for this software to [authenticate](https://www.home-assistant.io/docs/authentication/) with the [Home Assistant's API](https://developers.home-assistant.io/docs/api/rest/).

1. Log into your Home Assistant instance and go to your **User profile** page by selecting on the **circular icon** at the very bottom of the sidebar.

1. At the **top** switch to the **Security** tab and scroll down to the **bottom** of the page to the **Long-lived access tokens** section.

1. Click on the **Create Token** button and give it a name (ex. Everything Presence Zone Configurator).

1. Copy the token generated and save it in a **secure place** (ex. password manager) if you plan on using this later. You will **NOT** be able to display this sting again.

    **If you lose this token, you will have to delete the old one and generate a fresh one.**

#### 2. Create an `.env` File

Settings for the standalone Docker are controlled via [**environment variables**](https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/).

While it is not required, it is **recommended** you make an `.env` file in the root directory that you plan to run your commands.

The `.env` file will allow you to more easily store your settings and not mistakenly commit your private information to this repository if you contribute.

An `.env-example` file has been provided with sane defaults that you can copy and rename to `.env`.

**Example `.env` file:**

```bash
################
### OPTIONAL ###
################ 
# These environment variables are OPTIONAL for Docker Compose but mandatory for Portainer.

APP_PORT="42069"
FIRMWARE_LAN_PORT="38080"

################
### REQUIRED ###
################
# These environment variables are REQUIRED for ALL standalone deployment types.

HA_BASE_URL="http://homeassistant.local:8123"
HA_LONG_LIVED_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

| Parameter             |  Default                          | Required  | Function
|:----------------------|:----------------------------------|:---------:|:-
| `APP_PORT`            | `42069`                           | 🚫        | Port used to access web interface.
| `FIRMWARE_LAN_PORT`   | `38080`                           | 🚫        | Port ESP devices get served firmware updates.
| `HA_BASE_URL`         | `http://homeassistant.local:8123` | ✅        | URL to your Home Assistant Installation.
| `HA_LONG_LIVED_TOKEN` | `N/A`                             | ✅        | Long Lived Web Token generated by Home Assistant.

#### 3. Deploy Standalone Image

After creating a [Long Lived Token](#1-create-a-long-lived-token) and understanding what each [environment variable](#2-create-an-env-file) does, you are ready to deploy the standalone Docker.

Below are a few of the methods you can use to deploy the standalone Everything Presence Zone Configurator Docker.

You can use the links below to jump to the instructions for whichever method suits you.

- [**Deploy With Docker Compose**](#deploy-with-docker-compose)
- [**Deploy With Portainer**](#deploy-with-portainer)
- [**Deploy With Docker Run**](#deploy-with-docker-run)

#### Deploy With Docker Compose

**_Resources:_** For more details on how to use Docker Compose, refer to the [official Docker Compose documentation](https://docs.docker.com/compose/).

1. Go to the root directory of this project where the dockerfile is and run `docker compose up -d`.

    - **Note:** If you don't want to use a `.env` file just replace all sections that have a `${VARIABLE:-DEFAULT}` with your desired values.

      If you manually set the values then **make SURE the `38080:38080` section matches the `FIRMWARE_LAN_PORT` you set!**

      **For example if you set your `FIRMWARE_LAN_PORT` to `12345` then you must have a `- "12345:12345"` in the docker-compose.yaml**

    **Example `docker-compose.yaml` using `.env` file:**

    ```yaml
    services:
      zone-configurator:
        image: everythingsmarthome/everything-presence-mmwave-configurator:latest
        container_name: everything-presence-mmwave-configurator
        restart: unless-stopped
        ports:
          - "${APP_PORT:-42069}:42069"
          - "${FIRMWARE_LAN_PORT:-38080}:${FIRMWARE_LAN_PORT:-38080}"
        environment:
          HA_BASE_URL: "${HA_BASE_URL:-http://homeassistant.local:8123}"
          HA_LONG_LIVED_TOKEN: "${HA_LONG_LIVED_TOKEN}"
          FIRMWARE_LAN_PORT: "${FIRMWARE_LAN_PORT:-38080}"
        volumes:
          - ./config:/config
    ```

1. If you don't want to store the config files in the root folder you can optionally mount a named volume by adding the following.

    ```yaml
    services:
      zone-configurator:
        # Everything from before...
        volumes:
          # Add the named volume here.
          - epzone-config:/config
    
    # Create a named volume.
    volumes:
        epzone-config:
            driver: local
    ```

#### Deploy With Portainer

**_Resources:_**  For more details on how to use Portainer, refer to the [official Portainer documentation](https://docs.portainer.io/).

1. Log into your portainer instance.

1. Open the desired environment.

1. Create a new stack.

1. copy and paste the following into the editor.

    ```yaml
    services:
      zone-configurator:
        image: everythingsmarthome/everything-presence-mmwave-configurator:latest
        container_name: everything-presence-mmwave-configurator
        restart: unless-stopped
        ports:
          - "${APP_PORT:-42069}:42069"
          - "${FIRMWARE_LAN_PORT:-38080}:${FIRMWARE_LAN_PORT:-38080}"
        environment:
          HA_BASE_URL: "${HA_BASE_URL:-http://homeassistant.local:8123}"
          HA_LONG_LIVED_TOKEN: "${HA_LONG_LIVED_TOKEN}"
          FIRMWARE_LAN_PORT: "${FIRMWARE_LAN_PORT:-38080}"
        volumes:
          - epzone-config:/config

    volumes:
        epzone-config:
            driver: local
    ```

1. Either import your `.env` or set each variable in the **Environment Variables** section.

   - **NOTE:** Unlike normal `docker compose`, you will have to specify **ALL** variables mentioned in the [**.env**](#2-create-an-env-file) section. Portainer currently does **NOT** understand defaults like `${VARIABLE:-DEFAULT}` so it will error out if you do not specify them.

1. Deploy the stack.

#### Deploy With Docker Run

**_Resources:_** For more details on how to use Portainer, refer to the [official Docker documentation](https://docs.docker.com/).

1. Navigate to the root directory.

1. Run one of the following commands.

    **For either command below, make sure your firmware lan port matches the port exposed!**

    **If you set your FIRMWARE_LAN_PORT to 12345 then you must have a `-p "12345:12345"` in the command!**

- If you have created a `.env` then run the following command, otherwise skip to the next command in the list.

  ```bash
  docker run -d \
    --name everything-presence-mmwave-configurator \
    --restart unless-stopped \
    --env-file .env \
    -p 42069:42069 \
    -p 38080:38080 \
    -v "$(pwd)/config:/config" \
    everythingsmarthome/everything-presence-mmwave-configurator:latest
  ```

- To use `docker run` without an `.env` file do the following.

  ```bash
  docker run -d \
    --name everything-presence-mmwave-configurator \
    --restart unless-stopped \
    -p 42069:42069 \
    -p 38080:38080 \
    -e HA_BASE_URL="http://homeassistant.local:8123" \
    -e HA_LONG_LIVED_TOKEN="YOUR_TOKEN_HERE" \
    -e FIRMWARE_LAN_PORT="38080" \
    -v "$(pwd)/config:/config" \
    everythingsmarthome/everything-presence-mmwave-configurator:latest

  ```

---

### Everything Smart Home Documentation

For more information about Everything Presence devices, visit [Everything Smart Home](https://docs.everythingsmart.io)
