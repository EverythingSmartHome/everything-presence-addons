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

  // Zone selection system
  let currentZoneType = "regular";
  let currentZoneNumber = 1;
  let selectedZoneTile = null;

  // Animation system
  let animatedZones = new Map(); // Track zones with animations

  // Ghost zone preview system
  let ghostZone = null; // Track the preview zone being created
  let isCreatingZone = false; // Indicate zone creation mode

  // Hover effects system
  let hoveredZone = null; // Track which zone is being hovered
  let hoveredCorner = null; // Track which corner is being hovered
  let mousePosition = { x: 0, y: 0 }; // Track mouse position for effects

  // Animation helper functions
  function animateZoneCreation(zoneType, index) {
    const animationKey = `${zoneType}-${index}`;
    const startTime = Date.now();
    const duration = 300; // 300ms animation
    
    animatedZones.set(animationKey, {
      type: 'appear',
      startTime,
      duration,
      zoneType,
      index
    });
    
    // Schedule animation frame updates
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      if (progress < 1) {
        drawVisualization();
        requestAnimationFrame(animate);
      } else {
        animatedZones.delete(animationKey);
        drawVisualization();
      }
    };
    requestAnimationFrame(animate);
  }

  function animateZoneDeletion(zoneType, index, zone, callback) {
    const animationKey = `${zoneType}-${index}`;
    const startTime = Date.now();
    const duration = 250; // 250ms animation
    
    animatedZones.set(animationKey, {
      type: 'disappear',
      startTime,
      duration,
      zoneType,
      index,
      zone: { ...zone } // Store a copy of the zone data
    });
    
    // Schedule animation frame updates
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      if (progress < 1) {
        drawVisualization();
        requestAnimationFrame(animate);
      } else {
        animatedZones.delete(animationKey);
        callback(); // Execute the actual deletion
        drawVisualization();
      }
    };
    requestAnimationFrame(animate);
  }

  function getAnimationTransform(animationType, progress) {
    if (animationType === 'appear') {
      if (progress < 0.5) {
        // First half: scale from 0 to 1.05
        const t = progress * 2;
        return {
          scale: t * 1.05,
          opacity: t * 0.8
        };
      } else {
        // Second half: scale from 1.05 to 1
        const t = (progress - 0.5) * 2;
        return {
          scale: 1.05 - (t * 0.05),
          opacity: 0.8 + (t * 0.2)
        };
      }
    } else if (animationType === 'disappear') {
      if (progress < 0.5) {
        // First half: scale from 1 to 1.05
        const t = progress * 2;
        return {
          scale: 1 + (t * 0.05),
          opacity: 1 - (t * 0.5)
        };
      } else {
        // Second half: scale from 1.05 to 0
        const t = (progress - 0.5) * 2;
        return {
          scale: 1.05 - (t * 1.05),
          opacity: 0.5 - (t * 0.5)
        };
      }
    }
    return { scale: 1, opacity: 1 };
  }

  // Ghost zone drawing function
  function drawGhostZone(zone, zoneType) {
    if (!zone) return;
    
    const x = scaleX(Math.min(zone.beginX, zone.endX));
    const y = scaleY(Math.min(zone.beginY, zone.endY));
    const width = Math.abs(scaleX(zone.endX) - scaleX(zone.beginX));
    const height = Math.abs(scaleY(zone.endY) - scaleY(zone.beginY));

    // Save canvas state
    ctx.save();
    
    // Ghost zone styling
    const cornerRadius = 8;
    const isDarkMode = document.body.classList.contains("dark-mode");
    
    let fillColor, strokeColor, glowColor;
    
    if (zoneType === "regular") {
      fillColor = "#8b5cf620";
      strokeColor = "#8b5cf6";
      glowColor = "#8b5cf640";
    } else if (zoneType === "exclusion") {
      fillColor = "#f8717120";
      strokeColor = "#f87171";
      glowColor = "#f8717140";
    }

    // Draw glow effect
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = 12;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    
    // Draw semi-transparent fill
    ctx.fillStyle = fillColor;
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, cornerRadius);
    ctx.fill();
    
    // Reset shadow for border
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    
    // Draw dashed border
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.setLineDash([12, 6]);
    ctx.globalAlpha = 0.7;
    
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, cornerRadius);
    ctx.stroke();
    
    ctx.strokeStyle = strokeColor + "60"; // 60% opacity
    ctx.lineWidth = 1;
    ctx.setLineDash([8, 4]); // Smaller inner dash
    ctx.globalAlpha = 0.5;
    
    ctx.beginPath();
    ctx.roundRect(x + 2, y + 2, width - 4, height - 4, cornerRadius - 1);
    ctx.stroke();
    
    // Reset line dash and draw preview label
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.8;
    
    // Font for ghost label
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.font = "500 11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    
    const label = zoneType === "regular" ? "Zone Preview" : "Exclusion Preview";
    
    const textMetrics = ctx.measureText(label);
    const textWidth = textMetrics.width;
    const textHeight = 14;
    const textPadding = 7;
    const textX = x + 10;
    const textY = y + textHeight / 2 + 6;
    
    // Draw semi-transparent text background
    ctx.fillStyle = isDarkMode ? "rgba(0, 0, 0, 0.4)" : "rgba(255, 255, 255, 0.9)";
    ctx.beginPath();
    ctx.roundRect(textX - textPadding/2, textY - textHeight/2 + 1, textWidth + textPadding, textHeight - 2, 5);
    ctx.fill();
    
    ctx.fillStyle = isDarkMode ? "#ffffff" : "#1a202c";
    ctx.fillText(label, textX, textY);
    
    // Restore canvas state
    ctx.restore();
  }

  // Initialize zone tile selection
  function setupZoneTileSelection() {
    const zoneTiles = document.querySelectorAll('.zone-tile');
    
    // Set initial selection (Zone 1)
    const initialTile = document.querySelector('.zone-tile[data-zone-type="regular"][data-zone-number="1"]');
    if (initialTile) {
      selectZoneTile(initialTile);
    }

    zoneTiles.forEach(tile => {
      tile.addEventListener('click', () => {
        selectZoneTile(tile);
      });
    });
  }

  function selectZoneTile(tile) {
    // Remove previous selection
    if (selectedZoneTile) {
      selectedZoneTile.classList.remove('selected');
    }

    // Set new selection
    selectedZoneTile = tile;
    tile.classList.add('selected');
    
    // Update current zone type and number
    currentZoneType = tile.dataset.zoneType;
    currentZoneNumber = parseInt(tile.dataset.zoneNumber);
  }

  // Check if a target is inside a zone
  function isTargetInZone(target, zone) {
    if (!target || !zone || !target.active) return false;
    
    const minX = Math.min(zone.beginX, zone.endX);
    const maxX = Math.max(zone.beginX, zone.endX);
    const minY = Math.min(zone.beginY, zone.endY);
    const maxY = Math.max(zone.beginY, zone.endY);
    
    return target.x >= minX && target.x <= maxX && 
           target.y >= minY && target.y <= maxY;
  }

  // Check if any target has presence in a zone
  function checkZonePresence(zoneType, zoneNumber) {
    let zone = null;
    let haZone = null;
    
    if (zoneType === 'regular') {
      zone = userZones[zoneNumber - 1];
      haZone = haZones[zoneNumber - 1];
    } else {
      zone = exclusionZones[zoneNumber - 1];
      haZone = haExclusionZones[zoneNumber - 1];
    }
    
    // Use the active zone
    const activeZone = zone || haZone;
    if (!activeZone) return false;
    
    // Check if any active target is in zone
    return targets.some(target => isTargetInZone(target, activeZone));
  }

  // Update zone tile displays with current data
  function updateZoneTileDisplays() {
    // Update regular zones
    for (let i = 1; i <= 4; i++) {
      updateZoneTileDisplay('regular', i);
    }
    
    // Update exclusion zones
    for (let i = 1; i <= 2; i++) {
      updateZoneTileDisplay('exclusion', i);
    }
  }

  function updateZoneTileDisplay(zoneType, zoneNumber) {
    const tile = document.querySelector(`.zone-tile[data-zone-type="${zoneType}"][data-zone-number="${zoneNumber}"]`);
    if (!tile) return;

    const colorIndicator = tile.querySelector('.zone-color-indicator');
    const statusIndicator = tile.querySelector('.zone-status-indicator');
    const statusText = tile.querySelector('.zone-status-text');
    const xDisplay = tile.querySelector(`#${zoneType === 'regular' ? 'zone' : 'exclusion'}-${zoneNumber}-x-display`);
    const yDisplay = tile.querySelector(`#${zoneType === 'regular' ? 'zone' : 'exclusion'}-${zoneNumber}-y-display`);

    let zone = null;
    let haZone = null;
    
    // Get zone data
    if (zoneType === 'regular') {
      zone = userZones[zoneNumber - 1];
      haZone = haZones[zoneNumber - 1];
    } else {
      zone = exclusionZones[zoneNumber - 1];
      haZone = haExclusionZones[zoneNumber - 1];
    }

    // Check if entities exist and are enabled in Home Assistant
    const entityPrefix = zoneType === 'regular' ? `zone_${zoneNumber}` : `occupancy_mask_${zoneNumber}`;
    const hasEnabledEntities = selectedEntities && selectedEntities.some(entity => 
      entity.id.includes(entityPrefix) && entity.state !== 'unavailable' && entity.state !== 'unknown'
    );

    // Determine status
    const isDisabledCoordinates = haZone && 
      haZone.beginX === -6000 && haZone.endX === -6000 && 
      haZone.beginY === -1560 && haZone.endY === -1560;

    // Update coordinates display
    if (zone) {
      xDisplay.textContent = `${Math.round(zone.beginX)}, ${Math.round(zone.endX)}`;
      yDisplay.textContent = `${Math.round(zone.beginY)}, ${Math.round(zone.endY)}`;
    } else if (haZone && !isDisabledCoordinates) {
      xDisplay.textContent = `${Math.round(haZone.beginX)}, ${Math.round(haZone.endX)}`;
      yDisplay.textContent = `${Math.round(haZone.beginY)}, ${Math.round(haZone.endY)}`;
    } else {
      xDisplay.textContent = '—';
      yDisplay.textContent = '—';
    }
    
    // Determine overall status based on entity availability and configuration
    const isEntityDisabled = !hasEnabledEntities || !haZone;
    const isConfigured = zone != null || (haZone && !isDisabledCoordinates && 
      (haZone.beginX !== 0 || haZone.endX !== 0 || haZone.beginY !== 0 || haZone.endY !== 0));
    
    // Update tile class for tooltip
    tile.classList.toggle('disabled', isEntityDisabled);
    
    // Update status indicator
    statusIndicator.className = 'zone-status-indicator';
    if (isEntityDisabled) {
      // Grey: Entity is disabled in Home Assistant
      statusIndicator.classList.add('disabled');
    } else if (isConfigured) {
      // Green: Entity is enabled and zone is configured
      statusIndicator.classList.add('enabled-configured');
    } else {
      // Red: Entity is enabled but zone has default coordinates (not configured)
      statusIndicator.classList.add('enabled-not-configured');
    }

    // Update status text with presence detection
    statusText.className = 'zone-status-text';
    if (isEntityDisabled) {
      statusText.textContent = 'Entity Disabled';
      statusText.classList.add('disabled');
    } else if (isConfigured) {
      // Check for actual presence in the zone
      if (zoneType === 'regular') {
        const hasPresence = checkZonePresence(zoneType, zoneNumber);
        if (hasPresence) {
          statusText.textContent = 'Presence';
          statusText.classList.add('presence');
        } else {
          statusText.textContent = 'No Presence';
          statusText.classList.add('no-presence');
        }
      } else {
        statusText.textContent = 'Configured';
        statusText.classList.add('no-presence');
      }
    } else {
      statusText.textContent = 'Not Configured';
      statusText.classList.add('enabled-not-configured');
    }

    // Update colour indicator to match canvas
    updateZoneColorIndicator(colorIndicator, zoneType, zoneNumber, zone, haZone);
  }

  function updateZoneColorIndicator(colorIndicator, zoneType, zoneNumber, zone, haZone) {
    if (!colorIndicator) {
      return;
    }
    
    // Clear existing colour classes
    colorIndicator.className = 'zone-color-indicator';
    
    // Only show colour indicator if the zone has configuration
    const isDisabledCoordinates = haZone && 
      haZone.beginX === -6000 && haZone.endX === -6000 && 
      haZone.beginY === -1560 && haZone.endY === -1560;
    
    const hasConfiguration = zone != null || (haZone && !isDisabledCoordinates && 
      (haZone.beginX !== 0 || haZone.endX !== 0 || haZone.beginY !== 0 || haZone.endY !== 0));
    
    if (hasConfiguration) {
      let colorClass = '';
      if (zoneType === 'regular') {
        if (zone) {
          // User created zone - use purple
          colorClass = 'user-zone';
        } else {
          // HA zone - use color based on zone number
          colorClass = `ha-zone-${zoneNumber}`;
        }
      } else if (zoneType === 'exclusion') {
        colorClass = 'exclusion-zone';
      }
      
      if (colorClass) {
        colorIndicator.classList.add(colorClass);
      }
    }
  }

  const saveZonesButton = document.getElementById("saveZonesButton");

  saveZonesButton.addEventListener("click", saveZonesToHA);

  // ==========================
  //   === Persistence State ===
  // ==========================
  let isPersistenceEnabled = false; // Flag to toggle persistence
  let persistentDots = []; // Array to store persistent dots

  // ==========================
  //   === Collapsible Sections ===
  // ==========================
  function setupCollapsibleSections() {
    const targetTrackingInfo = document.getElementById("target-tracking-info");
    const targetTrackingHeader = document.getElementById("target-tracking-header");
    const targetTrackingToggle = document.getElementById("target-tracking-toggle");

    // Set to collapsed by default
    targetTrackingInfo.classList.add("collapsed");

    // Add click handler to header and toggle button
    const toggleCollapse = () => {
      targetTrackingInfo.classList.toggle("collapsed");
      
      // Update aria-expanded for accessibility
      const isCollapsed = targetTrackingInfo.classList.contains("collapsed");
      targetTrackingToggle.setAttribute("aria-expanded", !isCollapsed);
      
      // Save state to localStorage
      localStorage.setItem("targetTrackingCollapsed", isCollapsed);
    };

    targetTrackingHeader.addEventListener("click", toggleCollapse);
    targetTrackingToggle.addEventListener("click", (e) => {
      e.stopPropagation(); // Prevent double-trigger from header click
      toggleCollapse();
    });

    // Restore saved state
    const savedState = localStorage.getItem("targetTrackingCollapsed");
    if (savedState !== null) {
      const isCollapsed = savedState === "true";
      targetTrackingInfo.classList.toggle("collapsed", isCollapsed);
      targetTrackingToggle.setAttribute("aria-expanded", !isCollapsed);
    }
  }

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
      if (zone) { // Only draw non-null zones
        // Don't draw the zone being created, use Ghost zone
        if (!(isCreatingZone && dragType === "create" && draggingZone === index && currentZoneType === "regular")) {
          drawZone(zone, index, "user");
        }
      }
    });

    // Draw HA Exclusion zones (non-interactive)
    haExclusionZones.forEach((zone, index) => {
      drawZone(zone, index, "haExclusion");
    });

    // Draw exclusion zones (interactive)
    exclusionZones.forEach((zone, index) => {
      if (zone) { // Only draw non-null zones
        // Don't draw the exclusion zone being created, use Ghost Zone
        if (!(isCreatingZone && dragType === "create" && draggingZone === index && currentZoneType === "exclusion")) {
          drawZone(zone, index, "exclusion");
        }
      }
    });

    // Draw corner handles for hovered zones
    userZones.forEach((zone, index) => {
      if (zone && !(isCreatingZone && dragType === "create" && draggingZone === index && currentZoneType === "regular")) {
        drawCornerHandles(zone, index, "user");
      }
    });
    
    exclusionZones.forEach((zone, index) => {
      if (zone && !(isCreatingZone && dragType === "create" && draggingZone === index && currentZoneType === "exclusion")) {
        drawCornerHandles(zone, index, "exclusion");
      }
    });

    // Draw animated zones that are being deleted
    animatedZones.forEach((animation, key) => {
      if (animation.type === 'disappear' && animation.zone) {
        drawZone(animation.zone, animation.index, animation.zoneType);
      }
    });

    // Draw ghost zone preview
    if (isCreatingZone && ghostZone) {
      drawGhostZone(ghostZone, currentZoneType);
    }

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

    // Update zone tile displays
    updateZoneTileDisplays();
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

    // Check if this zone is being animated
    const animationKey = `${zoneType}-${index}`;
    const animation = animatedZones.get(animationKey);
    let transform = { scale: 1, opacity: 1 };
    
    if (animation) {
      const elapsed = Date.now() - animation.startTime;
      const progress = Math.min(elapsed / animation.duration, 1);
      transform = getAnimationTransform(animation.type, progress);
    }

    // Save canvas state for transform
    ctx.save();
    
    // Apply animation transforms
    if (transform.scale !== 1) {
      const centerX = x + width / 2;
      const centerY = y + height / 2;
      ctx.translate(centerX, centerY);
      ctx.scale(transform.scale, transform.scale);
      ctx.translate(-centerX, -centerY);
    }
    
    // Apply opacity
    ctx.globalAlpha = transform.opacity;

    // Zone styling
    const cornerRadius = 8;
    const isDarkMode = document.body.classList.contains("dark-mode");
    
    // Check if this zone is being hovered
    const isHovered = hoveredZone && 
                     hoveredZone.type === zoneType && 
                     hoveredZone.index === index &&
                     (zoneType === "user" || zoneType === "exclusion");
    
    // Define color schemes
    let fillGradient, strokeColor, shadowColor, labelColor;
    
    if (zoneType === "ha") {
      const colors = [
        { fill: ["#3b82f6", "#1d4ed8"], stroke: "#1e40af", shadow: "#3b82f680" }, // Blue
        { fill: ["#10b981", "#047857"], stroke: "#065f46", shadow: "#10b98180" }, // Green  
        { fill: ["#f59e0b", "#d97706"], stroke: "#92400e", shadow: "#f59e0b80" }, // Amber
        { fill: ["#ef4444", "#dc2626"], stroke: "#991b1b", shadow: "#ef444480" }, // Red
      ];
      const color = colors[index % colors.length];
      fillGradient = color.fill;
      strokeColor = color.stroke;
      shadowColor = color.shadow;
    } else if (zoneType === "user") {
      fillGradient = ["#8b5cf6", "#7c3aed"]; // Purple gradient
      strokeColor = "#6d28d9";
      shadowColor = "#8b5cf680";
    } else if (zoneType === "haExclusion") {
      fillGradient = ["#f87171", "#ef4444"]; // red gradient
      strokeColor = "#dc2626";
      shadowColor = "#f8717180";
    } else if (zoneType === "exclusion") {
      fillGradient = ["#f87171", "#ef4444"]; // red gradient
      strokeColor = "#dc2626";
      shadowColor = "#f8717180";
    }

    // Create gradient fill with hover
    const gradient = ctx.createLinearGradient(x, y, x, y + height);
    const topOpacity = isHovered ? "30" : "20";
    const bottomOpacity = isHovered ? "40" : "30";
    gradient.addColorStop(0, fillGradient[0] + topOpacity); // Enhanced opacity when hovered
    gradient.addColorStop(1, fillGradient[1] + bottomOpacity); // Enhanced opacity when hovered
    
    // Draw shadow effect with hover
    ctx.shadowColor = shadowColor;
    ctx.shadowBlur = isHovered ? 12 : 6;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = isHovered ? 3 : 2;

    // Draw rounded rectangle with gradient fill
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, cornerRadius);
    ctx.fill();
    
    // Reset shadow for border
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    
    // Draw border with hover
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = isHovered ? 3 : 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, cornerRadius);
    ctx.stroke();

    // Add inner highlight
    ctx.strokeStyle = fillGradient[0] + "40"; // 40% opacity highlight
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x + 1, y + 1, width - 2, height - 2, cornerRadius - 1);
    ctx.stroke();

    // Font for labels
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    
    // Use system fonts for better cross-platform
    ctx.font = "500 12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    
    let zoneLabel;
    if (zoneType === "ha") {
      zoneLabel = `HA Zone ${index + 1}`;
    } else if (zoneType === "user") {
      zoneLabel = `Zone ${index + 1}`;
    } else if (zoneType === "exclusion") {
      zoneLabel = `Exclusion ${index + 1}`;
    } else if (zoneType === "haExclusion") {
      zoneLabel = `HA Exclusion ${index + 1}`;
    }
    
    // Measure text for better positioning
    const textMetrics = ctx.measureText(zoneLabel);
    const textWidth = textMetrics.width;
    const textHeight = 16;
    const textPadding = 8;
    const textX = x + 10;
    const textY = y + textHeight / 2 + 6;
    
    // Draw text background
    ctx.fillStyle = isDarkMode ? "rgba(0, 0, 0, 0.3)" : "rgba(255, 255, 255, 0.8)";
    ctx.beginPath();
    ctx.roundRect(textX - textPadding/2, textY - textHeight/2 + 1, textWidth + textPadding, textHeight - 2, 6);
    ctx.fill();
    
    // Draw text
    ctx.fillStyle = isDarkMode ? "#ffffff" : "#1a202c";
    ctx.fillText(zoneLabel, textX, textY);
    
    // Restore canvas state
    ctx.restore();
  }

  // Draw corner handles for hover
  function drawCornerHandles(zone, index, zoneType) {
    if (!hoveredZone || hoveredZone.type !== zoneType || hoveredZone.index !== index) return;
    
    const x = scaleX(Math.min(zone.beginX, zone.endX));
    const y = scaleY(Math.min(zone.beginY, zone.endY));
    const width = Math.abs(scaleX(zone.endX) - scaleX(zone.beginX));
    const height = Math.abs(scaleY(zone.endY) - scaleY(zone.beginY));
    
    const baseHandleSize = 8;
    const pulseEffect = 0.2 * Math.sin(Date.now() * 0.003);
    const handleSize = baseHandleSize + pulseEffect;
    const isDarkMode = document.body.classList.contains("dark-mode");
    
    // Define corner positions
    const corners = [
      { x: x, y: y, corner: "top-left" },
      { x: x + width, y: y, corner: "top-right" },
      { x: x, y: y + height, corner: "bottom-left" },
      { x: x + width, y: y + height, corner: "bottom-right" }
    ];
    
    ctx.save();
    
    corners.forEach(corner => {
      const isHovered = hoveredCorner === corner.corner;
      
      // Draw glow effect for hovered corner
      if (isHovered) {
        ctx.shadowColor = isDarkMode ? "#ffffff60" : "#00000040";
        ctx.shadowBlur = 8;
      } else {
        ctx.shadowColor = "transparent";
        ctx.shadowBlur = 0;
      }
      
      // Draw corner handle
      ctx.fillStyle = isHovered 
        ? (isDarkMode ? "#ffffff" : "#1a202c")
        : (isDarkMode ? "#ffffff80" : "#1a202c80");
      
      ctx.beginPath();
      ctx.arc(corner.x, corner.y, handleSize / 2, 0, 2 * Math.PI);
      ctx.fill();
      
      // Draw inner dot
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.fillStyle = isHovered
        ? (isDarkMode ? "#1a202c" : "#ffffff")
        : (isDarkMode ? "#1a202c60" : "#ffffff60");
      
      ctx.beginPath();
      ctx.arc(corner.x, corner.y, 2, 0, 2 * Math.PI);
      ctx.fill();
    });
    
    ctx.restore();
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
  canvas.addEventListener("mouseleave", () => {
    // Clear hover states when mouse leaves canvas
    if (hoveredZone || hoveredCorner) {
      hoveredZone = null;
      hoveredCorner = null;
      canvas.style.cursor = "default";
      drawVisualization();
    }
  });

  // Keyboard event listener for canceling zone creation
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isCreatingZone) {
      // Cancel zone creation
      if (currentZoneType === "regular" && draggingZone !== null) {
        userZones[draggingZone] = null;
      } else if (currentZoneType === "exclusion" && draggingZone !== null) {
        exclusionZones[draggingZone] = null;
      }
      
      // Clear creation state
      ghostZone = null;
      isCreatingZone = false;
      isDragging = false;
      draggingZone = null;
      dragType = null;
      
      drawVisualization();
    }
  });

  // Animation loop for hover effects
  function animateHoverEffects() {
    if (hoveredZone) {
      // Redraw to update pulsing corner handles
      drawVisualization();
    }
    requestAnimationFrame(animateHoverEffects);
  }
  
  // Start the hover animation loop
  animateHoverEffects();

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
        // Create zone only for the selected zone number
        const targetIndex = currentZoneNumber - 1; // Convert to 0-based index
        
        // Check if zone already exists at this index
        if (userZones[targetIndex]) {
          alert(`Zone ${currentZoneNumber} already exists. Select an empty zone to create a new one.`);
          return;
        }
        
        // Ensure userZones array has enough slots
        while (userZones.length <= targetIndex) {
          userZones.push(null);
        }
        
        dragType = "create";
        draggingZone = targetIndex;
        isCreatingZone = true;
        const startX = unscaleX(mousePos.x);
        const startY = unscaleY(mousePos.y);
        
        // Create ghost zone for preview
        ghostZone = {
          beginX: startX,
          beginY: startY,
          endX: startX,
          endY: startY,
        };
        
        // Reserve the slot but don't create the actual zone yet
        userZones[targetIndex] = null;
        isDragging = true;
      } else if (currentZoneType === "exclusion") {
        // Create exclusion zone only for the selected zone number
        const targetIndex = currentZoneNumber - 1; // Convert to 0-based index
        
        // Check if exclusion zone already exists at this index
        if (exclusionZones[targetIndex]) {
          alert(`Exclusion Zone ${currentZoneNumber} already exists. Select an empty zone to create a new one.`);
          return;
        }
        
        // Ensure exclusionZones array has enough slots
        while (exclusionZones.length <= targetIndex) {
          exclusionZones.push(null);
        }
        
        dragType = "create";
        draggingZone = targetIndex;
        isCreatingZone = true;
        const startX = unscaleX(mousePos.x);
        const startY = unscaleY(mousePos.y);
        
        // Create ghost zone for preview
        ghostZone = {
          beginX: startX,
          beginY: startY,
          endX: startX,
          endY: startY,
        };
        
        // Reserve the slot but don't create the actual zone yet
        exclusionZones[targetIndex] = null;
        isDragging = true;
      }
    }
  }

  function onMouseMove(e) {
    const mousePos = getMousePos(canvas, e);
    mousePosition = { x: mousePos.x, y: mousePos.y };
    const zoneInfo = getZoneAtPosition(mousePos);
    
    if (!isDragging) {
      // Update hover states for interactive zones
      let redrawNeeded = false;
      const prevHoveredZone = hoveredZone;
      const prevHoveredCorner = hoveredCorner;
      
      if (zoneInfo !== null && (zoneInfo.zoneType === "user" || zoneInfo.zoneType === "exclusion")) {
        hoveredZone = { type: zoneInfo.zoneType, index: zoneInfo.index };
        hoveredCorner = zoneInfo.corner;
        canvas.style.cursor = zoneInfo.corner ? "nwse-resize" : "move";
      } else {
        hoveredZone = null;
        hoveredCorner = null;
        canvas.style.cursor = "crosshair";
      }
      
      // Check if hover state changed and redraw if needed
      if (JSON.stringify(prevHoveredZone) !== JSON.stringify(hoveredZone) || 
          prevHoveredCorner !== hoveredCorner) {
        redrawNeeded = true;
      }
      
      if (redrawNeeded) {
        drawVisualization();
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
      const newEndX = Math.max(-6000, Math.min(6000, unscaleX(mousePos.x)));
      const newEndY = Math.max(-offsetY, Math.min(7500, unscaleY(mousePos.y)));
      
      // Only update ghost zone for preview during creation
      if (ghostZone) {
        ghostZone.endX = Math.round(newEndX);
        ghostZone.endY = Math.round(newEndY);
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
    // Check finished creating a zone
    if (dragType === "create" && draggingZone !== null && ghostZone) {
      // Create the actual zone from the ghost zone data
      if (currentZoneType === "regular") {
        userZones[draggingZone] = {
          beginX: ghostZone.beginX,
          beginY: ghostZone.beginY,
          endX: ghostZone.endX,
          endY: ghostZone.endY,
        };
      } else if (currentZoneType === "exclusion") {
        exclusionZones[draggingZone] = {
          beginX: ghostZone.beginX,
          beginY: ghostZone.beginY,
          endX: ghostZone.endX,
          endY: ghostZone.endY,
        };
      }
      
      const zoneType = currentZoneType === "regular" ? "user" : "exclusion";
      animateZoneCreation(zoneType, draggingZone);
    }
    
    // Clear ghost zone and creation state
    if (isCreatingZone) {
      ghostZone = null;
      isCreatingZone = false;
    }
    
    isDragging = false;
    draggingZone = null;
    dragType = null;
    resizeCorner = null;
  }

  function onRightClick(e) {
    e.preventDefault();
    
    // Cancel zone creation if in progress
    if (isCreatingZone) {
      // Remove the incomplete zone
      if (currentZoneType === "regular" && draggingZone !== null) {
        userZones[draggingZone] = null;
      } else if (currentZoneType === "exclusion" && draggingZone !== null) {
        exclusionZones[draggingZone] = null;
      }
      
      // Clear creation state
      ghostZone = null;
      isCreatingZone = false;
      isDragging = false;
      draggingZone = null;
      dragType = null;
      
      drawVisualization();
      return;
    }
    
    const mousePos = getMousePos(canvas, e);
    const zoneInfo = getZoneAtPosition(mousePos);
    if (zoneInfo !== null) {
      const { index, zoneType } = zoneInfo;
      if (zoneType === "user") {
        if (confirm(`Delete User Zone ${index + 1}?`)) {
          const zone = userZones[index];
          animateZoneDeletion("user", index, zone, () => {
            userZones[index] = null; // Set to null instead of removing
            updateCoordinatesOutput();
            updateZoneTileDisplays();
          });
        }
      } else if (zoneType === "exclusion") {
        if (confirm(`Delete Exclusion Zone ${index + 1}?`)) {
          const zone = exclusionZones[index];
          animateZoneDeletion("exclusion", index, zone, () => {
            exclusionZones[index] = null; // Set to null instead of removing
            updateCoordinatesOutput();
            updateZoneTileDisplays();
          });
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
      if (!zone) continue; // Skip null zones
      
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
      if (!zone) continue; // Skip null zones
      
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
      if (zone) { // Only output non-null zones
        output += `Zone ${index + 1} X Begin: ${zone.beginX}, X End: ${zone.endX},
       Y Begin: ${zone.beginY}, Y End: ${zone.endY}\n`;
      }
    });

    // Check if any exclusion zones exist
    const hasExclusionZones = exclusionZones.some(zone => zone !== null);
    if (hasExclusionZones) {
      output += "\nExclusion Zones:\n";
      exclusionZones.forEach((zone, index) => {
        if (zone) { // Only output non-null zones
          output += `Exclusion Zone ${index + 1} X Begin: ${zone.beginX}, X End: ${zone.endX}, Y Begin: ${zone.beginY}, Y End: ${zone.endY}\n`;
        }
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
    const documentRoot = document.documentElement;

    const savedMode = localStorage.getItem("darkMode");

    if (savedMode === "enabled") {
      documentRoot.classList.add("dark-mode");
      document.body.classList.add("dark-mode");
      darkModeToggle.textContent = "🌞";
    } else if (savedMode === "disabled") {
      documentRoot.classList.remove("dark-mode");
      document.body.classList.remove("dark-mode");
      darkModeToggle.textContent = "🌙";
    } else if (prefersDarkScheme.matches) {
      documentRoot.classList.add("dark-mode");
      document.body.classList.add("dark-mode");
      darkModeToggle.textContent = "🌞";
    }

    darkModeToggle.addEventListener("click", () => {
      documentRoot.classList.toggle("dark-mode");
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
                    {% if model == 'Everything_Presence_Lite' or model == 'Everything Presence Lite' or model == 'Everything Presence Pro' or model == 'Everything_Presence_Pro'%}
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

    // Convert zones object to arrays
    const reconstructedRegularZones = [];
    const reconstructedExclusionZones = [];

    Object.keys(zones).forEach((key) => {
      const zone = zones[key];
      if (key.startsWith("occupancy_mask")) {
        // Extract zone number
        const zoneNumber = parseInt(key.match(/occupancy_mask_(\d+)/)[1]);
        const zoneIndex = zoneNumber - 1; // Convert to 0-based index
        
        // Ensure array has enough slots
        while (reconstructedExclusionZones.length <= zoneIndex) {
          reconstructedExclusionZones.push(null);
        }
        
        reconstructedExclusionZones[zoneIndex] = {
          beginX: zone.beginX || 0,
          beginY: zone.beginY || 0,
          endX: zone.endX || 0,
          endY: zone.endY || 0,
        };
      } else if (key.startsWith("zone")) {
        // Extract zone number
        const zoneNumber = parseInt(key.match(/zone_(\d+)/)[1]);
        const zoneIndex = zoneNumber - 1; // Convert to 0-based index
        
        // Ensure array has enough slots
        while (reconstructedRegularZones.length <= zoneIndex) {
          reconstructedRegularZones.push(null);
        }
        
        reconstructedRegularZones[zoneIndex] = {
          beginX: zone.beginX || 0,
          beginY: zone.beginY || 0,
          endX: zone.endX || 0,
          endY: zone.endY || 0,
        };
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
      updateZoneTileDisplays(); // Update zone tiles after fetching HA zones

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
    setupCollapsibleSections();
    setupZoneTileSelection();
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
      
      // Reload data to get the updated HA zones
      await fetchLiveData();
      
      drawVisualization();
      updateCoordinatesOutput();
      updateZoneTileDisplays(); // Update the sidebar tiles after saving
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
      // Check for Regular Zones
      let match = entityId.match(regularZoneRegex);
      if (match) {
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
