document.addEventListener("DOMContentLoaded", () => {
  // Canvas and context
  const canvas = document.getElementById("visualizationCanvas");
  const ctx = canvas.getContext("2d");

  // Variables for device selection
  const deviceSelect = document.getElementById("device-select");
  let selectedEntities = [];
  let targets = [];
  let haZones = [];
  let haExclusionZones = [];
  let userZones = [];
  let exclusionZones = [];

  // Variables for live refresh
  const refreshRateInput = document.getElementById("refreshRateInput");
  const setRefreshRateButton = document.getElementById("setRefreshRateButton");
  const toggleRefreshButton = document.getElementById("toggleRefreshButton");
  const statusIndicator = document.getElementById("statusIndicator");
  let refreshInterval = 500;
  let refreshIntervalId = null;
  let isFetchingData = false;
  let installationAngle = 0;
  let detectionRange = 6000;
  let offsetY = 0;

  // Variables for dragging and resizing
  let isDragging = false;
  let draggingZone = null;
  let draggingZoneType = null;
  let dragType = null; // 'move', 'resize', 'create'
  let resizeCorner = null;
  const dragOffset = { x: 0, y: 0 };

  // Scaling functions
  const scale = canvas.width / 12000; // 0.08 pixels/mm

  // Define unique colors for HA Zones
  const haZoneColors = [
    { fill: "rgba(255, 0, 0, 0.1)", stroke: "red" },
    { fill: "rgba(0, 255, 0, 0.1)", stroke: "green" },
    { fill: "rgba(0, 0, 255, 0.1)", stroke: "blue" },
    { fill: "rgba(255, 255, 0, 0.1)", stroke: "yellow" },
  ];

  const zoneTypeSelect = document.getElementById("zone-type-select");
  let currentZoneType = "regular";

  zoneTypeSelect.addEventListener("change", (event) => {
    currentZoneType = event.target.value;
  });

  const saveZonesButton = document.getElementById("saveZonesButton");

  saveZonesButton.addEventListener("click", saveZonesToHA);

  // ==========================
  //   === Persistence State ===
  // ==========================
  let isPersistenceEnabled = false; // Flag to toggle persistence
  let persistentDots = []; // Array to store persistent dots

  // Add a button for toggling persistence
  const persistenceToggleButton = document.getElementById("persistenceToggleButton");

  // If the button doesn't exist, create and append it to the body
  if (!persistenceToggleButton) {
    const button = document.createElement("button");
    button.id = "persistenceToggleButton";
    button.textContent = "Enable Persistence";
    // Style the button as needed
    button.style.marginLeft = "10px";
    // Append to a suitable container, e.g., next to saveZonesButton
    saveZonesButton.parentElement.appendChild(button);
  }

  // Now, fetch the button
  const persistenceButton = document.getElementById("persistenceToggleButton");

  // Event listener to toggle persistence
  persistenceButton.addEventListener("click", () => {
    isPersistenceEnabled = !isPersistenceEnabled;
    persistenceButton.textContent = isPersistenceEnabled ? "Disable Persistence" : "Enable Persistence";

    if (isPersistenceEnabled) {
      // Set refresh rate to 250ms when persistence is enabled
      setRefreshRate(250, true); // Pass a flag to indicate it's a programmatic change
    } else {
      // Revert to user-specified refresh rate when persistence is disabled
      const userRefreshRate = parseInt(refreshRateInput.value, 10) || 500;
      setRefreshRate(userRefreshRate, true);
      // Optionally clear persistent dots when disabled
      persistentDots = [];
      drawVisualization();
    }
  });

  // ==========================
  //   === Scaling Functions ===
  // ==========================
  function scaleX(value) {
    return (value + 6000) * scale;
  }

  function unscaleX(value) {
    return value / scale - 6000;
  }

  function scaleY(value) {
    return (value + offsetY) * scale;
  }

  function unscaleY(value) {
    return value / scale - offsetY;
  }

  function calculateOffsetY() {
    let absAngle = Math.abs(installationAngle);
    if (absAngle <= 30) offsetY = 0;
    else offsetY = detectionRange * Math.sin(((absAngle - 30) * Math.PI) / 180);
  }

  /// Returns the entity's state converted from whatever unit is configured in the UI converted to millimeters
  function getEntityStateMM(entity) {
    const state = entity ? parseFloat(entity.state) || 0 : 0;
    let result = state;
    // cm, in, ft, km, m, mi, nmi, yd are supported in home assistant
    switch (entity.attributes.unit_of_measurement) {
      case "mm":
        break; // Avoid checking every unit for the most common case
      case "in":
        result = state * 25.4; // Convert inches to millimeters
        break;
      case "ft":
        result = state * 304.8; // Convert feet to millimeters
        break;
      case "km":
        result = state * 1000000; // Convert kilometers to millimeters
        break;
      case "m":
        result = state * 1000; // Convert meters to millimeters
        break;
      case "mi":
        result = state * 1.609e6; // Convert miles to millimeters
        break;
      case "nmi":
        result = state * 1.852e6; // Convert nautical miles to millimeters
        break;
      case "yd":
        result = state * 914.4; // Convert yards to millimeters
        break;
    }
    return Math.round(result);
  }

  // ==========================
  //    === Drawing Functions ===
  // ==========================
  function drawVisualization() {
    // Clear the canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw grid lines
    drawGrid();

    // Draw radar background
    drawRadarBackground();

    // Draw HA zones (non-interactive)
    haZones.forEach((zone, index) => {
      drawZone(zone, index, "ha");
    });

    // Draw user zones (interactive)
    userZones.forEach((zone, index) => {
      drawZone(zone, index, "user");
    });

    // Draw HA Exclusion zones (non-interactive)
    haExclusionZones.forEach((zone, index) => {
      drawZone(zone, index, "haExclusion");
    });

    // Draw exclusion zones (interactive)
    exclusionZones.forEach((zone, index) => {
      drawZone(zone, index, "exclusion");
    });

    // Draw targets
    targets.forEach((target) => {
      if (target.active) {
        drawTarget(target);
      }
    });

    // ==========================
    // === Draw Persistent Dots ==
    // ==========================
    if (isPersistenceEnabled) {
      drawPersistentDots();
    }
  }

  function drawRadarBackground() {
    const centerX = scaleX(0);
    const centerY = scaleY(0);
    const halfDetectionAngle = 60;
    const startAngleRadians =
      ((-halfDetectionAngle - installationAngle) / 180) * Math.PI;
    const endAngleRadians =
      ((halfDetectionAngle - installationAngle) / 180) * Math.PI;

    const startAngle = Math.PI / 2 + startAngleRadians;
    const endAngle = Math.PI / 2 + endAngleRadians;

    const radius = scaleY(detectionRange) - scaleY(0);

    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, startAngle, endAngle, false);
    ctx.closePath();

    ctx.fillStyle = "rgba(168, 216, 234, 0.15)";
    ctx.fill();

    ctx.strokeStyle = "rgba(168, 216, 234, 0.5)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function drawZone(zone, index, zoneType) {
    const x = scaleX(Math.min(zone.beginX, zone.endX));
    const y = scaleY(Math.min(zone.beginY, zone.endY));
    const width = Math.abs(scaleX(zone.endX) - scaleX(zone.beginX));
    const height = Math.abs(scaleY(zone.endY) - scaleY(zone.beginY));

    if (zoneType === "ha") {
      const color = haZoneColors[index % haZoneColors.length];
      ctx.fillStyle = color.fill;
      ctx.strokeStyle = color.stroke;
      ctx.lineWidth = 2;
    } else if (zoneType === "user") {
      ctx.fillStyle = "rgba(90, 34, 139, 0.1)";
      ctx.strokeStyle = "purple";
      ctx.lineWidth = 2;
    } else if (zoneType === "haExclusion") {
      ctx.fillStyle = "rgba(255, 255, 0, 0.1)";
      ctx.strokeStyle = "yellow";
      ctx.lineWidth = 2;
    } else if (zoneType === "exclusion") {
      ctx.fillStyle = "rgba(255, 165, 0, 0.1)"; // Orange with transparency
      ctx.strokeStyle = "orange";
      ctx.lineWidth = 2;
    }

    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.fill();
    ctx.stroke();
    ctx.closePath();

    // Set text color based on current theme
    const isDarkMode = document.body.classList.contains("dark-mode");
    ctx.fillStyle = isDarkMode ? "#e0e0e0" : "#333333";
    ctx.font = "12px Open Sans";

    let zoneLabel;
    if (zoneType === "ha") {
      zoneLabel = `HA Zone ${index + 1}`;
    } else if (zoneType === "user") {
      zoneLabel = `User Zone ${index + 1}`;
    } else if (zoneType === "exclusion") {
      zoneLabel = `Exclusion Zone ${index + 1}`;
    } else if (zoneType === "haExclusion") {
      zoneLabel = `HA Exclusion Zone ${index + 1}`;
    }
    ctx.fillText(zoneLabel, x + 5, y + 15);
  }

  function drawTarget(target) {
    const x = scaleX(target.x);
    const y = scaleY(target.y);

    ctx.beginPath();
    ctx.arc(x, y, 5, 0, 2 * Math.PI);
    ctx.fillStyle = "red";
    ctx.fill();
    ctx.closePath();
  }

  // ==========================
  //   === Persistent Dots ===
  // ==========================
  function drawPersistentDots() {
    ctx.fillStyle = "black"; // Choose desired color for persistent dots
    persistentDots.forEach((dot) => {
      ctx.beginPath();
      ctx.arc(scaleX(dot.x), scaleY(dot.y), 3, 0, 2 * Math.PI);
      ctx.fill();
      ctx.closePath();
    });
  }

  // ==========================
  //    === Event Listeners ===
  // ==========================
  // Event listeners for canvas interactions
  canvas.addEventListener("mousedown", onMouseDown);
  canvas.addEventListener("mousemove", onMouseMove);
  canvas.addEventListener("mouseup", onMouseUp);
  canvas.addEventListener("contextmenu", onRightClick);

  function onMouseDown(e) {
    const mousePos = getMousePos(canvas, e);
    const zoneInfo = getZoneAtPosition(mousePos);

    if(e.button === 2) return; // This prevents deleting then creating zones by ignoring right clicks

    if (zoneInfo !== null) {
      const { index, corner, zoneType } = zoneInfo;
      draggingZone = index;
      draggingZoneType = zoneType;
      dragOffset.x = mousePos.x;
      dragOffset.y = mousePos.y;

      if (corner) {
        dragType = "resize";
        resizeCorner = corner;
      } else {
        dragType = "move";
        resizeCorner = null;
      }
      isDragging = true;
    } else {
      if (currentZoneType === "regular") {
        // Start creating a new user zone if less than 4 user zones
        if (userZones.length < 4) {
          dragType = "create";
          draggingZone = userZones.length;
          const startX = unscaleX(mousePos.x);
          const startY = unscaleY(mousePos.y);
          userZones.push({
            beginX: startX,
            beginY: startY,
            endX: startX,
            endY: startY,
          });
          isDragging = true;
        } else {
          alert("Maximum of 4 user zones allowed.");
        }
      } else if (currentZoneType === "exclusion") {
        const maxExclusionZones = 2;
        if (exclusionZones.length < maxExclusionZones) {
          dragType = "create";
          draggingZone = exclusionZones.length;
          const startX = unscaleX(mousePos.x);
          const startY = unscaleY(mousePos.y);
          exclusionZones.push({
            beginX: startX,
            beginY: startY,
            endX: startX,
            endY: startY,
          });
          isDragging = true;
        } else {
          alert(`Maximum of ${maxExclusionZones} exclusion zones allowed.`);
        }
      }
    }
  }

  function onMouseMove(e) {
    const mousePos = getMousePos(canvas, e);
    const zoneInfo = getZoneAtPosition(mousePos);
    if (!isDragging) {
      // Update cursor style based on hover state
      if (zoneInfo !== null) {
        if (zoneInfo.zoneType === "user" || zoneInfo.zoneType === "exclusion") {
          canvas.style.cursor = zoneInfo.corner ? "nwse-resize" : "move";
        }
      } else {
        canvas.style.cursor = "crosshair";
      }
      return;
    }
    let dx = unscaleX(mousePos.x) - unscaleX(dragOffset.x);
    let dy = unscaleY(mousePos.y) - unscaleY(dragOffset.y);

    if (dragType === "move") {
      if (draggingZoneType === "user") {
        let zone = userZones[draggingZone];

        let newBeginX = zone.beginX + dx;
        let newEndX = zone.endX + dx;
        let newBeginY = zone.beginY + dy;
        let newEndY = zone.endY + dy;

        // Constrain within boundaries
        if (newBeginX < -6000) {
          dx += -6000 - newBeginX;
        }
        if (newEndX > 6000) {
          dx += 6000 - newEndX;
        }
        if (newBeginY < -offsetY) {
          dy += -offsetY - newBeginY;
        }
        if (newEndY > 7500) {
          dy += 7500 - newEndY;
        }

        zone.beginX += dx;
        zone.endX += dx;
        zone.beginY += dy;
        zone.endY += dy;

        zone.beginX = Math.round(zone.beginX);
        zone.endX = Math.round(zone.endX);
        zone.beginY = Math.round(zone.beginY);
        zone.endY = Math.round(zone.endY);
      } else if (draggingZoneType === "exclusion") {
        let zone = exclusionZones[draggingZone];
        let newBeginX = zone.beginX + dx;
        let newEndX = zone.endX + dx;
        let newBeginY = zone.beginY + dy;
        let newEndY = zone.endY + dy;

        // Adjust dx and dy to prevent moving beyond boundaries
        if (newBeginX < -6000) {
          dx += -6000 - newBeginX;
        }
        if (newEndX > 6000) {
          dx += 6000 - newEndX;
        }
        if (newBeginY < -offsetY) {
          dy += -offsetY - newBeginY;
        }
        if (newEndY > 7500) {
          dy += 7500 - newEndY;
        }

        zone.beginX += dx;
        zone.endX += dx;
        zone.beginY += dy;
        zone.endY += dy;

        zone.beginX = Math.round(zone.beginX);
        zone.endX = Math.round(zone.endX);
        zone.beginY = Math.round(zone.beginY);
        zone.endY = Math.round(zone.endY);
      }
    } else if (dragType === "resize") {
      if (draggingZoneType === "user") {
        const zone = userZones[draggingZone];
        adjustZoneCornerWithConstraints(zone, resizeCorner, dx, dy);
      } else if (draggingZoneType === "exclusion") {
        const zone = exclusionZones[draggingZone];
        adjustZoneCornerWithConstraints(zone, resizeCorner, dx, dy);
      }
    } else if (dragType === "create") {
      if (currentZoneType === "regular") {
        const zone = userZones[draggingZone];
        zone.endX = Math.max(-6000, Math.min(6000, unscaleX(mousePos.x)));
        zone.endY = Math.max(-offsetY, Math.min(7500, unscaleY(mousePos.y)));
        zone.endX = Math.round(zone.endX);
        zone.endY = Math.round(zone.endY);
      } else if (currentZoneType === "exclusion") {
        const zone = exclusionZones[draggingZone];
        zone.endX = Math.max(-6000, Math.min(6000, unscaleX(mousePos.x)));
        zone.endY = Math.max(-offsetY, Math.min(7500, unscaleY(mousePos.y)));
        zone.endX = Math.round(zone.endX);
        zone.endY = Math.round(zone.endY);
      }
    }

    dragOffset.x = mousePos.x;
    dragOffset.y = mousePos.y;

    drawVisualization();
    updateCoordinatesOutput();
  }

  function drawGrid() {
    const gridSize = 1000; // Grid every 1000 mm
    ctx.strokeStyle = "#e0e0e0";
    ctx.lineWidth = 1;

    // Vertical grid lines
    for (let x = -6000; x <= 6000; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(scaleX(x), scaleY(-2000));
      ctx.lineTo(scaleX(x), scaleY(7500));
      ctx.stroke();
    }

    // Horizontal grid lines
    for (let y = -2000; y <= 7500; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(scaleX(-6000), scaleY(y));
      ctx.lineTo(scaleX(6000), scaleY(y));
      ctx.stroke();
    }
  }

  function onMouseUp(e) {
    isDragging = false;
    draggingZone = null;
    dragType = null;
    resizeCorner = null;
  }

  function onRightClick(e) {
    e.preventDefault();
    const mousePos = getMousePos(canvas, e);
    const zoneInfo = getZoneAtPosition(mousePos);
    if (zoneInfo !== null) {
      const { index, zoneType } = zoneInfo;
      if (zoneType === "user") {
        if (confirm(`Delete User Zone ${index + 1}?`)) {
          userZones.splice(index, 1);
          drawVisualization();
          updateCoordinatesOutput();
        }
      } else if (zoneType === "exclusion") {
        if (confirm(`Delete Exclusion Zone ${index + 1}?`)) {
          exclusionZones.splice(index, 1);
          drawVisualization();
          updateCoordinatesOutput();
        }
      }
    }
  }

  function adjustZoneCornerWithConstraints(zone, corner, dx, dy) {
    let newBeginX = zone.beginX;
    let newEndX = zone.endX;
    let newBeginY = zone.beginY;
    let newEndY = zone.endY;

    if (corner === "top-left") {
      newBeginX += dx;
      newBeginY += dy;
      // Constrain to boundaries and not beyond opposite corner
      newBeginX = Math.max(-6000, Math.min(newBeginX, zone.endX));
      newBeginY = Math.max(-offsetY, Math.min(newBeginY, zone.endY));
    } else if (corner === "top-right") {
      newEndX += dx;
      newBeginY += dy;
      newEndX = Math.min(6000, Math.max(newEndX, zone.beginX));
      newBeginY = Math.max(-offsetY, Math.min(newBeginY, zone.endY));
    } else if (corner === "bottom-left") {
      newBeginX += dx;
      newEndY += dy;
      newBeginX = Math.max(-6000, Math.min(newBeginX, zone.endX));
      newEndY = Math.min(7500, Math.max(newEndY, zone.beginY));
    } else if (corner === "bottom-right") {
      newEndX += dx;
      newEndY += dy;
      newEndX = Math.min(6000, Math.max(newEndX, zone.beginX));
      newEndY = Math.min(7500, Math.max(newEndY, zone.beginY));
    }

    // Apply the new positions
    zone.beginX = Math.round(newBeginX);
    zone.endX = Math.round(newEndX);
    zone.beginY = Math.round(newBeginY);
    zone.endY = Math.round(newEndY);
  }

  function getMousePos(canvas, evt) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: evt.clientX - rect.left,
      y: evt.clientY - rect.top,
    };
  }

  function getZoneAtPosition(pos) {
    // Check exclusion zones first (higher priority)
    for (let i = exclusionZones.length - 1; i >= 0; i--) {
      const zone = exclusionZones[i];
      const x = scaleX(Math.min(zone.beginX, zone.endX));
      const y = scaleY(Math.min(zone.beginY, zone.endY));
      const width = Math.abs(scaleX(zone.endX) - scaleX(zone.beginX));
      const height = Math.abs(scaleY(zone.endY) - scaleY(zone.beginY));

      const handleSize = 8;
      const corners = [
        { x: x, y: y, corner: "top-left", type: "exclusion", index: i },
        {
          x: x + width,
          y: y,
          corner: "top-right",
          type: "exclusion",
          index: i,
        },
        {
          x: x,
          y: y + height,
          corner: "bottom-left",
          type: "exclusion",
          index: i,
        },
        {
          x: x + width,
          y: y + height,
          corner: "bottom-right",
          type: "exclusion",
          index: i,
        },
      ];
      for (const corner of corners) {
        if (
          pos.x >= corner.x - handleSize / 2 &&
          pos.x <= corner.x + handleSize / 2 &&
          pos.y >= corner.y - handleSize / 2 &&
          pos.y <= corner.y + handleSize / 2
        ) {
          return {
            index: corner.index,
            corner: corner.corner,
            zoneType: corner.type,
          };
        }
      }

      if (
        pos.x >= x &&
        pos.x <= x + width &&
        pos.y >= y &&
        pos.y <= y + height
      ) {
        return { index: i, corner: null, zoneType: "exclusion" };
      }
    }

    // Check user zones next
    for (let i = userZones.length - 1; i >= 0; i--) {
      const zone = userZones[i];
      const x = scaleX(Math.min(zone.beginX, zone.endX));
      const y = scaleY(Math.min(zone.beginY, zone.endY));
      const width = Math.abs(scaleX(zone.endX) - scaleX(zone.beginX));
      const height = Math.abs(scaleY(zone.endY) - scaleY(zone.beginY));

      const handleSize = 8;
      const corners = [
        { x: x, y: y, corner: "top-left", type: "user", index: i },
        { x: x + width, y: y, corner: "top-right", type: "user", index: i },
        { x: x, y: y + height, corner: "bottom-left", type: "user", index: i },
        {
          x: x + width,
          y: y + height,
          corner: "bottom-right",
          type: "user",
          index: i,
        },
      ];
      for (const corner of corners) {
        if (
          pos.x >= corner.x - handleSize / 2 &&
          pos.x <= corner.x + handleSize / 2 &&
          pos.y >= corner.y - handleSize / 2 &&
          pos.y <= corner.y + handleSize / 2
        ) {
          return { index: corner.index, corner: corner.corner, zoneType: corner.type };
        }
      }

      if (
        pos.x >= x &&
        pos.x <= x + width &&
        pos.y >= y &&
        pos.y <= y + height
      ) {
        return { index: i, corner: null, zoneType: "user" };
      }
    }
    return null;
  }

  // ==========================
  //    === Coordinates Output ===
  // ==========================
  const coordinatesOutput = document.getElementById("coordinatesOutput");

  function updateCoordinatesOutput() {
    let output = "User Zones:\n";
    userZones.forEach((zone, index) => {
      output += `Zone ${index + 1} X Begin: ${zone.beginX}, X End: ${zone.endX},
       Y Begin: ${zone.beginY}, Y End: ${zone.endY}\n`;
    });

    if (exclusionZones.length > 0) {
      output += "\nExclusion Zones:\n";
      exclusionZones.forEach((zone, index) => {
        output += `Exclusion Zone ${index + 1} X Begin: ${zone.beginX}, X End: ${zone.endX}, Y Begin: ${zone.beginY}, Y End: ${zone.endY}\n`;
      });
    }

    coordinatesOutput.textContent = output;
  }

  // ==========================
  //   === Fetch Entity State ===
  // ==========================
  async function fetchEntityState(entityId) {
    if (!entityId) {
      console.error("Attempted to fetch entity with undefined ID.");
      return null;
    }

    try {
      const response = await fetch(`api/entities/${entityId}`);
      if (!response.ok) {
        throw new Error(
          `Failed to fetch entity ${entityId}: ${response.statusText}`
        );
      }
      return await response.json();
    } catch (error) {
      console.error(`Error fetching entity ${entityId}:`, error);
      return null;
    }
  }

  // ==========================
  //   === Dark Mode Toggle ===
  // ==========================
  const darkModeToggle = document.getElementById("dark-mode-toggle");

  function setupDarkModeToggle() {
    const prefersDarkScheme = window.matchMedia("(prefers-color-scheme: dark)");

    const savedMode = localStorage.getItem("darkMode");

    if (savedMode === "enabled") {
      document.body.classList.add("dark-mode");
      darkModeToggle.textContent = "🌞";
    } else if (savedMode === "disabled") {
      document.body.classList.remove("dark-mode");
      darkModeToggle.textContent = "🌙";
    } else if (prefersDarkScheme.matches) {
      document.body.classList.add("dark-mode");
      darkModeToggle.textContent = "🌞";
    }

    darkModeToggle.addEventListener("click", () => {
      document.body.classList.toggle("dark-mode");

      // Update button text and save preference
      if (document.body.classList.contains("dark-mode")) {
        darkModeToggle.textContent = "🌞";
        localStorage.setItem("darkMode", "enabled");
      } else {
        darkModeToggle.textContent = "🌙";
        localStorage.setItem("darkMode", "disabled");
      }

      // Redraw visualization to reflect theme change
      drawVisualization();
    });
  }

  // ==========================
  //   === Device Dropdown ===
  // ==========================
  // Populate device selection drop-down
  async function fetchDevices() {
    const template = `
        {% set devices = namespace(list=[]) %}
            {% for device in states | map(attribute='entity_id') | map('device_id') | unique | reject('none') %}
                {% set model = device_attr(device, 'model') %}
                {% set manufacturer = device_attr(device, 'manufacturer') %}
                {% if manufacturer == 'EverythingSmartTechnology' %}
                    {% if model == 'Everything_Presence_Lite' or model == 'Everything Presence Lite' %}
                        {% set device_name = device_attr(device, 'name_by_user') or device_attr(device, 'name') %}
                        {% set devices.list = devices.list + [{'id': device, 'name': device_name}] %}
                    {% endif %}
                {% endif %}
            {% endfor %}
        {{ devices.list | tojson }}
      `;
    const result = await executeTemplate(template);
    if (result) {
      try {
        const devices = JSON.parse(result);
        populateDeviceDropdown(devices);
      } catch (e) {
        console.error("Error parsing devices JSON:", e);
        alert("Failed to parse devices data.");
      }
    }
  }

  function populateDeviceDropdown(devices) {
    const deviceSelect = document.getElementById("device-select");
    deviceSelect.innerHTML =
      '<option value="" disabled selected>Select a device</option>';

    devices.forEach((device) => {
      const option = document.createElement("option");
      option.value = device.id;
      option.textContent = device.name;
      deviceSelect.appendChild(option);
    });
  }

  // ==========================
  //   === Entity Dropdown ===
  // ==========================
  // Populate entity selection drop-down based on selected device
  async function populateEntityDropdown(deviceId) {
    const template = `
          {{ device_entities('${deviceId}') | tojson }}
      `;
    const result = await executeTemplate(template);
    if (result) {
      try {
        const entities = JSON.parse(result);
        const requiredEntities = filterRequiredEntities(entities);
        selectedEntities = requiredEntities.map((entityId) => ({
          id: entityId,
          name: entityId,
        }));

        if (selectedEntities.length === 0) {
          alert("No relevant entities found for this device.");
          return;
        }

        startLiveRefresh();
      } catch (e) {
        console.error("Error parsing entities JSON:", e);
        alert("Failed to parse entities data.");
      }
    }
  }

  // Function to filter required entities based on naming conventions
  function filterRequiredEntities(entities) {
    const requiredSuffixes = [
      // Zone Coordinates
      "zone_1_begin_x",
      "zone_1_begin_y",
      "zone_1_end_x",
      "zone_1_end_y",
      "zone_2_begin_x",
      "zone_2_begin_y",
      "zone_2_end_x",
      "zone_2_end_y",
      "zone_3_begin_x",
      "zone_3_begin_y",
      "zone_3_end_x",
      "zone_3_end_y",
      "zone_4_begin_x",
      "zone_4_begin_y",
      "zone_4_end_x",
      "zone_4_end_y",

      // Target Tracking
      "target_1_active",
      "target_2_active",
      "target_3_active",

      // Target Coordinates and Attributes
      "target_1_x",
      "target_1_y",
      "target_1_speed",
      "target_1_resolution",
      "target_2_x",
      "target_2_y",
      "target_2_speed",
      "target_2_resolution",
      "target_3_x",
      "target_3_y",
      "target_3_speed",
      "target_3_resolution",

      // Target Angles and Distances
      "target_1_angle",
      "target_2_angle",
      "target_3_angle",
      "target_1_distance",
      "target_2_distance",
      "target_3_distance",

      // Zone Occupancy Off Delay
      "zone_1_occupancy_off_delay",
      "zone_2_occupancy_off_delay",
      "zone_3_occupancy_off_delay",
      "zone_4_occupancy_off_delay",

      // Configured Values
      "max_distance",
      "installation_angle",

      // Occupancy Masks
      "occupancy_mask_1_begin_x",
      "occupancy_mask_1_begin_y",
      "occupancy_mask_1_end_x",
      "occupancy_mask_1_end_y",
      "occupancy_mask_2_begin_x",
      "occupancy_mask_2_begin_y",
      "occupancy_mask_2_end_x",
      "occupancy_mask_2_end_y",
    ];

    return entities.filter((entityId) => {
      return requiredSuffixes.some((suffix) => entityId.endsWith(suffix));
    });
  }

  // ==========================
  // === Handle Device Selection ===
  // ==========================
  // Handle device selection change
  function handleDeviceSelection() {
    deviceSelect.addEventListener("change", async (event) => {
      const selectedDeviceId = event.target.value;
      if (selectedDeviceId) {
        await populateEntityDropdown(selectedDeviceId);
        targets = [];
        haZones = [];
        userZones = [];
        haExclusionZones = [];
        exclusionZones = [];
        persistentDots = []; // Clear persistent dots when a new device is selected
        drawVisualization();
        updateCoordinatesOutput();
      }
    });
  }

  // ==========================
  // === Refresh Rate Controls ===
  // ==========================
  function setupRefreshRateControls() {
    setRefreshRateButton.addEventListener("click", () => {
      const newRate = parseInt(refreshRateInput.value, 10);
      if (isNaN(newRate) || newRate < 100) {
        alert("Please enter a valid refresh rate (minimum 100 ms).");
        return;
      }

      setRefreshRate(newRate, false); // Pass false to indicate user-initiated change
    });
  }

  /**
   * Sets the refresh rate and restarts the live refresh if needed.
   * @param {number} rate - The new refresh rate in milliseconds.
   * @param {boolean} isProgrammatic - Indicates if the change is programmatic (e.g., persistence toggle).
   */
  function setRefreshRate(rate, isProgrammatic) {
    refreshInterval = rate;
    refreshRateInput.value = rate;

    if (refreshIntervalId !== null) {
      clearInterval(refreshIntervalId);
    }

    if (selectedEntities.length === 0) {
      alert("No entities selected for live updating.");
      return;
    }

    fetchLiveData();

    refreshIntervalId = setInterval(fetchLiveData, refreshInterval);

    statusIndicator.textContent = `Status: Refreshing every ${refreshInterval} ms`;

    // Update toggleRefreshButton text based on whether it's starting or stopping
    // If it's programmatic, keep the current state
    if (!isProgrammatic) {
      isRefreshing = true;
      toggleRefreshButton.textContent = "Stop Refresh";
    }
  }

  // ==========================
  // === Live Refresh ===
  // ==========================
  let isRefreshing = false; // To track refresh state

  function startLiveRefresh() {
    if (refreshIntervalId !== null) {
      clearInterval(refreshIntervalId);
    }

    if (selectedEntities.length === 0) {
      alert("No entities selected for live updating.");
      return;
    }

    fetchLiveData();

    refreshIntervalId = setInterval(fetchLiveData, refreshInterval);

    statusIndicator.textContent = `Status: Refreshing every ${refreshInterval} ms`;
    isRefreshing = true;
    toggleRefreshButton.textContent = "Stop Refresh";
  }

  function stopLiveRefresh() {
    if (refreshIntervalId !== null) {
      clearInterval(refreshIntervalId);
      refreshIntervalId = null;
      statusIndicator.textContent = "Status: Not Refreshing";
      isRefreshing = false;
      toggleRefreshButton.textContent = "Start Refresh";
    }
  }

  function toggleRefresh() {
    if (isRefreshing) {
      stopLiveRefresh();
    } else {
      // Update refreshInterval from input before starting
      const newRate = parseInt(refreshRateInput.value, 10);
      if (isNaN(newRate) || newRate < 100) {
        alert("Please enter a valid refresh rate (minimum 100 ms).");
        return;
      }
      setRefreshRate(newRate, false); // Pass false to indicate user-initiated change
    }
  }

  // Update the event listener for the toggle button
  toggleRefreshButton.addEventListener("click", toggleRefresh);

  // ==========================
  // === Reconstruct Zones ===
  // ==========================
  function reconstructZones(entities) {
    const zones = {};

    entities.forEach((entity) => {
      const entityId = entity.entity_id;
      const match =
        entityId.match(/zone_(\d+)_(begin|end)_(x|y)$/) ||
        entityId.match(/occupancy_mask_(\d+)_(begin|end)_(x|y)$/);

      if (match) {
        const zoneType = entityId.includes("occupancy_mask")
          ? "occupancy_mask"
          : "zone";
        const zoneNumber = match[1]; // e.g., '1' for zone_1
        const position = match[2]; // 'begin' or 'end'
        const axis = match[3]; // 'x' or 'y'

        const zoneKey = `${zoneType}_${zoneNumber}`;

        if (!zones[zoneKey]) {
          zones[zoneKey] = {};
        }

        // Assign values based on axis
        if (axis === "x") {
          if (position === "begin") {
            zones[zoneKey].beginX = parseFloat(entity.state) || 0;
          } else {
            zones[zoneKey].endX = parseFloat(entity.state) || 0;
          }
        } else if (axis === "y") {
          if (position === "begin") {
            zones[zoneKey].beginY = parseFloat(entity.state) || 0;
          } else {
            zones[zoneKey].endY = parseFloat(entity.state) || 0;
          }
        }
      }
    });

    // Convert zones object to an array
    const reconstructedRegularZones = [];
    const reconstructedExclusionZones = [];

    Object.keys(zones).forEach((key) => {
      const zone = zones[key];
      if (key.startsWith("occupancy_mask")) {
        reconstructedExclusionZones.push({
          beginX: zone.beginX || 0,
          beginY: zone.beginY || 0,
          endX: zone.endX || 0,
          endY: zone.endY || 0,
        });
      } else if (key.startsWith("zone")) {
        reconstructedRegularZones.push({
          beginX: zone.beginX || 0,
          beginY: zone.beginY || 0,
          endX: zone.endX || 0,
          endY: zone.endY || 0,
        });
      }
    });

    return {
      regularZones: reconstructedRegularZones,
      exclusionZones: reconstructedExclusionZones,
    };
  }

  // ==========================
  // === Target Tracking ===
  // ==========================
  function updateTargetTrackingInfo() {
    // Assuming targets array has 3 targets
    targets.forEach((target) => {
      const targetNumber = target.number;
      if (targetNumber >= 1 && targetNumber <= 3) {
        document.getElementById(`target-${targetNumber}-status`).textContent =
          target.active ? "Active" : "Inactive";
        document.getElementById(`target-${targetNumber}-x`).textContent =
          target.x;
        document.getElementById(`target-${targetNumber}-y`).textContent =
          target.y;
        document.getElementById(`target-${targetNumber}-speed`).textContent =
          target.speed;
        document.getElementById(
          `target-${targetNumber}-resolution`,
        ).textContent = target.resolution;
        document.getElementById(`target-${targetNumber}-angle`).textContent =
          target.angle;
        document.getElementById(`target-${targetNumber}-distance`).textContent =
          target.distance;
      }
    });
  }

  // ==========================
  // === Live Data Fetching ===
  // ==========================
  async function fetchLiveData() {
    if (isFetchingData) {
      return;
    }
    isFetchingData = true;

    try {
      // Fetch data for all selected entities
      const dataPromises = selectedEntities.map((entity) =>
        fetchEntityState(entity.id),
      );
      const entityStates = await Promise.all(dataPromises);

      const reconstructed = reconstructZones(entityStates);
      haZones = reconstructed.regularZones;
      haExclusionZones = reconstructed.exclusionZones;

      // Process targets based on entity states
      const targetNumbers = [1, 2, 3];
      const updatedTargets = targetNumbers.map((targetNumber) => {
        // Find corresponding entities for the target
        const activeEntity = selectedEntities.find((entity) =>
          entity.id.includes(`target_${targetNumber}_active`)
        );
        const xEntity = selectedEntities.find((entity) =>
          entity.id.includes(`target_${targetNumber}_x`)
        );
        const yEntity = selectedEntities.find((entity) =>
          entity.id.includes(`target_${targetNumber}_y`)
        );
        const speedEntity = selectedEntities.find((entity) =>
          entity.id.includes(`target_${targetNumber}_speed`)
        );
        const resolutionEntity = selectedEntities.find((entity) =>
          entity.id.includes(`target_${targetNumber}_resolution`)
        );
        const angleEntity = selectedEntities.find((entity) =>
          entity.id.includes(`target_${targetNumber}_angle`)
        );
        const distanceEntity = selectedEntities.find((entity) =>
          entity.id.includes(`target_${targetNumber}_distance`)
        );

        // Extract data from entityStates
        const activeData = entityStates.find(
          (entity) => entity.entity_id === (activeEntity ? activeEntity.id : "")
        );
        const xData = entityStates.find(
          (entity) => entity.entity_id === (xEntity ? xEntity.id : "")
        );
        const yData = entityStates.find(
          (entity) => entity.entity_id === (yEntity ? yEntity.id : "")
        );
        const speedData = entityStates.find(
          (entity) => entity.entity_id === (speedEntity ? speedEntity.id : "")
        );
        const resolutionData = entityStates.find(
          (entity) => entity.entity_id === (resolutionEntity ? resolutionEntity.id : "")
        );
        const angleData = entityStates.find(
          (entity) => entity.entity_id === (angleEntity ? angleEntity.id : "")
        );
        const distanceData = entityStates.find(
          (entity) => entity.entity_id === (distanceEntity ? distanceEntity.id : "")
        );

        return {
          number: targetNumber,
          active: activeData && activeData.state === "on",
          x: getEntityStateMM(xData),
          y: getEntityStateMM(yData),
          speed: getEntityStateMM(speedData),
          resolution: resolutionData ? resolutionData.state : "N/A",
          angle: angleData ? parseFloat(angleData.state) || 0 : 0,
          distance: getEntityStateMM(distanceData),
        };
      });

      targets = updatedTargets;

      detectionRange = entityStates.find(
        (entity) => entity.entity_id.endsWith(`max_distance`)
      )?.state ?? 600;
      detectionRange *= 10; // Convert from cm to mm

      let newInstallationAngle = Number(
        entityStates.find((entity) =>
          entity.entity_id.endsWith(`installation_angle`),
        )?.state ?? 0,
      );

      if (installationAngle != newInstallationAngle) {
        installationAngle = newInstallationAngle;
        calculateOffsetY();
      }

      // ==========================
      // === Handle Persistence ===
      // ==========================
      if (isPersistenceEnabled) {
        targets.forEach((target) => {
          if (target.active) {
            const lastDot = persistentDots[persistentDots.length - 1];
            if (!lastDot || lastDot.x !== target.x || lastDot.y !== target.y) {
              persistentDots.push({ x: target.x, y: target.y });
              // Optional: Limit the number of persistent dots
              if (persistentDots.length > 1000) { // Example limit
                persistentDots.shift(); // Remove oldest dot
              }
            }
          }
        });
      }

      // Draw the visualization
      drawVisualization();
      updateCoordinatesOutput();

      // Update Target Tracking Info Box
      updateTargetTrackingInfo();
    } catch (error) {
      console.error("Error fetching live data:", error);
      statusIndicator.textContent = "Status: Error Fetching Data";
    } finally {
      isFetchingData = false;
    }
  }

  // ==========================
  // === Initialize the App ===
  // ==========================
  async function init() {
    await fetchDevices(); // Fetch and populate devices
    handleDeviceSelection();
    setupDarkModeToggle();
    setupRefreshRateControls();
  }

  // ==========================
  // === Execute Template ===
  // ==========================
  async function executeTemplate(template) {
    try {
      const response = await fetch("api/template", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ template }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to execute template");
      }

      const result = await response.text();
      return result;
    } catch (error) {
      console.error("Error executing template:", error);
      alert(`Error executing template: ${error.message}`);
    }
  }

  // ==========================
  // === Save Zones to HA ===
  // ==========================
  async function saveZonesToHA() {
    if (!selectedEntities || selectedEntities.length === 0) {
      alert("No entities loaded. Please select a valid device.");
      return;
    }

    // Ensure we have entities for all zones (4 zones, each with begin_x, begin_y, end_x, end_y)
    const zoneEntities = extractZoneEntities(selectedEntities);
    if (Object.keys(zoneEntities).length === 0) {
      alert("Failed to find zone entities.");
      return;
    }

    // Prepare regular zones (up to 4)
    const regularZonesToSave = [];
    for (let i = 0; i < 4; i++) {
      if (userZones[i]) {
        regularZonesToSave.push({
          beginX: userZones[i].beginX || 0,
          endX: userZones[i].endX || 0,
          beginY: userZones[i].beginY || 0,
          endY: userZones[i].endY || 0,
        });
      } else {
        regularZonesToSave.push({
          beginX: 0,
          endX: 0,
          beginY: 0,
          endY: 0,
        });
      }
    }

    const exclusionZonesToSave = exclusionZones.map((zone) => ({
      beginX: zone.beginX || 0,
      endX: zone.endX || 0,
      beginY: zone.beginY || 0,
      endY: zone.endY || 0,
    }));

    // Send the regular zones
    try {
      for (let i = 0; i < regularZonesToSave.length; i++) {
        const zone = regularZonesToSave[i];
        await saveZoneToHA(i + 1, zone, zoneEntities);
      }

      // Send the exclusion zone
      for (let i = 0; i < exclusionZonesToSave.length; i++) {
        const zone = exclusionZonesToSave[i];
        await saveExclusionZoneToHA(i + 1, zone, zoneEntities);
      }

      alert("Zones saved successfully!");
      userZones = [];
      exclusionZones = [];
      persistentDots = []; // Optionally clear persistent dots after saving
      drawVisualization();
      updateCoordinatesOutput();
    } catch (error) {
      console.error("Error saving zones:", error);
      alert("Failed to save zones.");
    }
  }

  // ==========================
  // === Extract Zone Entities ===
  // ==========================
  function extractZoneEntities(entities) {
    const zoneEntities = {};

    const regularZoneRegex = /zone_(\d+)_(begin|end)_(x|y)$/;
    const exclusionZoneRegex = /occupancy_mask_(\d+)_(begin|end)_(x|y)$/;

    entities.forEach((entity) => {
      const entityId = entity.id;
      console.log(entityId);
      // Check for Regular Zones
      let match = entityId.match(regularZoneRegex);
      if (match) {
        console.log(entityId);
        const [_, zoneNumber, position, axis] = match;
        const key = `zone_${zoneNumber}_${position}_${axis}`;
        zoneEntities[key] = entityId;
        return;
      }

      // Check for Exclusion Zones
      match = entityId.match(exclusionZoneRegex);
      if (match) {
        const [_, maskNumber, position, axis] = match;
        const key = `occupancy_mask_${maskNumber}_${position}_${axis}`;
        zoneEntities[key] = entityId;
        return;
      }
    });

    return zoneEntities;
  }

  // ==========================
  // === Save Zone to HA ===
  // ==========================
  async function saveZoneToHA(zoneNumber, zone, zoneEntities) {
    const baseUrl = "api/services/number/set_value";

    const zonePrefix = `zone_${zoneNumber}`;

    const roundToNearestTen = (num) => {
      return (Math.round(num / 10) * 10).toFixed(1);
    };

    const requests = [
      fetch(`${baseUrl}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity_id: zoneEntities[`${zonePrefix}_begin_x`],
          value: roundToNearestTen(zone.beginX),
        }),
      }),
      fetch(`${baseUrl}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity_id: zoneEntities[`${zonePrefix}_end_x`],
          value: roundToNearestTen(zone.endX),
        }),
      }),
      fetch(`${baseUrl}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity_id: zoneEntities[`${zonePrefix}_begin_y`],
          value: roundToNearestTen(zone.beginY),
        }),
      }),
      fetch(`${baseUrl}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity_id: zoneEntities[`${zonePrefix}_end_y`],
          value: roundToNearestTen(zone.endY),
        }),
      }),
    ];

    await Promise.all(requests);
  }

  // ==========================
  // === Export Zones ===
  // === by charmines ===
  // ==========================
  document.getElementById("exportZonesButton").addEventListener("click", exportZones);
  async function exportZones() {
    if (!selectedEntities || selectedEntities.length === 0) {
      alert("No entities loaded. Please select a valid device.");
      return;
    }

    // Ensure we have entities for all zones (4 zones, each with begin_x, begin_y, end_x, end_y)
    const zoneEntities = extractZoneEntities(selectedEntities);
    if (Object.keys(zoneEntities).length === 0) {
      alert("Failed to find zone entities.");
      return;
    }

    const name = prompt("Enter a name for the exported zones:");

    const zones = {
      name,
      userZones,
      exclusionZones,
      haZones,
      haExclusionZones,
    };
    console.log("Exporting Zones", zones);

    const blob = new Blob([JSON.stringify(zones)], { type: "text/plain" });
    const url = URL.createObjectURL(blob);

    // Create a link element and set its attributes
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `zones_${name}.json`);

    // Append the link to the DOM, click it, and remove it
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    let zeConf = "Zones Exported!\nThe following zones types will be imported upon request:";

    if (zones.userZones.length > 0) {
      zeConf += "\nUser Zones";
    } else if (zones.haZones.length > 0) {
      zeConf += "\nHA Zones";
    }

    if (zones.exclusionZones.length > 0) {
      zeConf += "\nExclusion Zones";
    } else if (zones.haExclusionZones.length > 0) {
      zeConf += "\nHA Exclusion Zones";
    }

    alert(zeConf);
  }

  // ==========================
  // === Import Zones ===
  // === by charmines ===
  // ==========================
  document.getElementById("importZonesButton").addEventListener("click", importZones);
  async function importZones() {
    if (!selectedEntities || selectedEntities.length === 0) {
      alert("No entities loaded. Please select a valid device.");
      return;
    }

    // Ensure we have entities for all zones (4 zones, each with begin_x, begin_y, end_x, end_y)
    const zoneEntities = extractZoneEntities(selectedEntities);
    if (Object.keys(zoneEntities).length === 0) {
      alert("Failed to find zone entities.");
      return;
    }

    // Create File Input
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    document.body.appendChild(input);

    // Handle the input event
    input.onchange = () => {
      const reader = new FileReader();

      reader.onload = function (e) {
        const importedZones = JSON.parse(e.target.result);
        console.log("Import Content:", importedZones);

        exclusionZones = importedZones.exclusionZones;
        if (importedZones.userZones.length > 0) {
          userZones = importedZones.userZones;
        } else {
          userZones = importedZones.haZones;
        }

        if (importedZones.exclusionZones.length > 0) {
          exclusionZones = importedZones.exclusionZones;
        } else {
          exclusionZones = importedZones.haExclusionZones;
        }

        drawVisualization();
        updateCoordinatesOutput();
        alert("Zones Imported! Zones must be saved to apply!");
      };

      reader.readAsText(input.files[0]);

      document.body.removeChild(input);
    };
    input.click();
  }

  // ==========================
  // === Reset Zones ===
  // === by charmines ===
  // ==========================
  document.getElementById("resetZonesButton").addEventListener("click", resetZones);
  function resetZones() {
    if (
      confirm(
        "Are you sure you want to reset zones?\nThis will clear user zones but will not change applied (HA) zones"
      )
    ) {
      userZones = [];
      exclusionZones = [];
      drawVisualization();
      updateCoordinatesOutput();
    }
  }

  // ==========================
  // === HA -> User Zones ===
  // === by charmines ===
  // ==========================
  document.getElementById("haUserZonesButton").addEventListener("click", haUserZones);
  async function haUserZones() {
    for await (const zone of haZones) {
      if (zone.beginX === 0 && zone.endX === 0 && zone.beginY === 0 && zone.endY === 0)
        break;
      const zoneIndex = haZones.indexOf(zone);
      userZones[zoneIndex] = zone;
    }
    for await (const zone of haExclusionZones) {
      if (zone.beginX === 0 && zone.endX === 0 && zone.beginY === 0 && zone.endY === 0)
        break;
      const zoneIndex = haExclusionZones.indexOf(zone);
      exclusionZones[zoneIndex] = zone;
    }
    drawVisualization();
    updateCoordinatesOutput();
  }

  // ==========================
  // === Save Exclusion Zone to HA ===
  // ==========================
  async function saveExclusionZoneToHA(zoneNumber, zone, zoneEntities) {
    const baseUrl = "api/services/number/set_value";

    const zonePrefix = `occupancy_mask_${zoneNumber}`;
    console.log("Saving Exclusion Zone:", zonePrefix);
    console.log("Zone Entities:", zoneEntities);

    const roundToNearestTen = (num) => {
      return (Math.round(num / 10) * 10).toFixed(1);
    };

    const keys = [
      `${zonePrefix}_begin_x`,
      `${zonePrefix}_end_x`,
      `${zonePrefix}_begin_y`,
      `${zonePrefix}_end_y`,
    ];

    const requests = keys.map((key) => {
      const entityId = zoneEntities[key];
      if (!entityId) {
        console.warn(`Entity ID for ${key} not found. Skipping this field.`);
        return Promise.resolve();
      }

      let value;
      switch (key) {
        case `${zonePrefix}_begin_x`:
          value = roundToNearestTen(zone.beginX);
          break;
        case `${zonePrefix}_end_x`:
          value = roundToNearestTen(zone.endX);
          break;
        case `${zonePrefix}_begin_y`:
          value = roundToNearestTen(zone.beginY);
          break;
        case `${zonePrefix}_end_y`:
          value = roundToNearestTen(zone.endY);
          break;
        default:
          value = 0;
      }

      return fetch(`${baseUrl}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity_id: entityId,
          value: value,
        }),
      });
    });

    // Execute all fetch requests
    await Promise.all(requests);
  }

  // ==========================
  // === Extract and Process Persistence ===
  // ==========================
  // The persistence functionality has been integrated within fetchLiveData function above.

  // ==========================
  // === Initialize the App ===
  // ==========================
  init();
});
