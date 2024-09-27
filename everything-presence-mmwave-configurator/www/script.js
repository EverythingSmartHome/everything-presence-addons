document.addEventListener('DOMContentLoaded', () => { 
  // Canvas and context
  const canvas = document.getElementById('visualizationCanvas');
  const ctx = canvas.getContext('2d');

  // Variables for device selection
  const deviceSelect = document.getElementById('device-select');
  let selectedDeviceId = '';
  let selectedEntities = []; // Array of {id: entity_id, name: friendly_name}
  let targets = [];
  let haZones = [];    // Zones from Home Assistant (non-interactive)
  let userZones = [];  // Zones created by the user (interactive)

  // Variables for live refresh
  const refreshRateInput = document.getElementById('refreshRateInput');
  const setRefreshRateButton = document.getElementById('setRefreshRateButton');
  const stopRefreshButton = document.getElementById('stopRefreshButton');
  const statusIndicator = document.getElementById('statusIndicator');
  let refreshInterval = 500; // Default to 500 ms
  let refreshIntervalId = null;
  let isFetchingData = false;

  // Variables for dragging and resizing
  let isDragging = false;
  let draggingZone = null;
  let dragType = null; // 'move', 'resize', 'create'
  let resizeCorner = null;
  const dragOffset = { x: 0, y: 0 };

  // Scaling functions
  const scale = canvas.width / 12000; // 0.08 pixels/mm

  // Define unique colors for HA Zones
const haZoneColors = [
  { fill: 'rgba(255, 0, 0, 0.1)', stroke: 'red' },        // Zone 1: Red
  { fill: 'rgba(0, 255, 0, 0.1)', stroke: 'green' },      // Zone 2: Green
  { fill: 'rgba(0, 0, 255, 0.1)', stroke: 'blue' },       // Zone 3: Blue
  { fill: 'rgba(255, 255, 0, 0.1)', stroke: 'yellow' },   // Zone 4: Yellow
];

const saveZonesButton = document.getElementById('saveZonesButton');

// Event listener for "Save Zones" button
saveZonesButton.addEventListener('click', saveZonesToHA);


  function scaleX(value) {
    return (value + 6000) * scale;
  }

  function unscaleX(value) {
    return value / scale - 6000;
  }

  function scaleY(value) {
    return value * scale;
  }

  function unscaleY(value) {
    return value / scale;
  }

  // Drawing functions
  function drawVisualization() {
      // Clear the canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    
      // Draw grid lines
      drawGrid();
    
      // Draw radar background
      drawRadarBackground();
    
      // Draw HA zones (non-interactive)
      haZones.forEach((zone, index) => {
          drawZone(zone, index, 'ha');
      });
    
      // Draw user zones (interactive)
      userZones.forEach((zone, index) => {
          drawZone(zone, index, 'user');
      });
    
      // Draw targets
      targets.forEach((target) => {
          if (target.active) {
              drawTarget(target);
          }
      });
  }

  function drawRadarBackground() {
      const centerX = canvas.width / 2;
      const centerY = 0;

      const detectionRange = 7500; // in mm
      const halfAngleRadians = Math.atan(10000 / detectionRange);

      const startAngle = (Math.PI / 2) - halfAngleRadians;
      const endAngle = (Math.PI / 2) + halfAngleRadians;

      const radius = scaleY(detectionRange);

      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.arc(centerX, centerY, radius, startAngle, endAngle, false);
      ctx.closePath();

      ctx.fillStyle = 'rgba(168, 216, 234, 0.15)';
      ctx.fill();

      ctx.strokeStyle = 'rgba(168, 216, 234, 0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
  }

  function drawZone(zone, index, zoneType) {
      const x = scaleX(Math.min(zone.beginX, zone.endX));
      const y = scaleY(Math.min(zone.beginY, zone.endY));
      const width = Math.abs(scaleX(zone.endX) - scaleX(zone.beginX));
      const height = Math.abs(scaleY(zone.endY) - scaleY(zone.beginY));

      if (zoneType === 'ha') {
          const color = haZoneColors[index % haZoneColors.length];
          ctx.fillStyle = color.fill;
          ctx.strokeStyle = color.stroke;
          ctx.lineWidth = 2;
      } else if (zoneType === 'user') {
          ctx.fillStyle = 'rgba(90, 34, 139, 0.1)';
          ctx.strokeStyle = 'purple';
          ctx.lineWidth = 2;
      }

      ctx.beginPath();
      ctx.rect(x, y, width, height);
      ctx.fill();
      ctx.stroke();
      ctx.closePath();

      ctx.fillStyle = 'black';
      ctx.font = '12px Open Sans';
      const zoneLabel = zoneType === 'ha' ? `HA Zone ${index + 1}` : `User Zone ${index + 1}`;
      ctx.fillText(zoneLabel, x + 5, y + 15);
  }

  function drawTarget(target) {
      const x = scaleX(target.x);
      const y = scaleY(target.y);
  
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, 2 * Math.PI);
      ctx.fillStyle = 'red';
      ctx.fill();
      ctx.closePath();
  }

  // Event listeners for canvas interactions
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('contextmenu', onRightClick);

  function onMouseDown(e) {
      const mousePos = getMousePos(canvas, e);
      const zoneInfo = getZoneAtPosition(mousePos);
    
      if (zoneInfo !== null) {
          const { index, corner } = zoneInfo;
          draggingZone = index;
          dragOffset.x = mousePos.x;
          dragOffset.y = mousePos.y;
      
          if (corner) {
              dragType = 'resize';
              resizeCorner = corner;
          } else {
              dragType = 'move';
              resizeCorner = null;
          }
          isDragging = true;
      } else {
          // Start creating a new user zone if less than 4 user zones
          if (userZones.length < 4) {
              dragType = 'create';
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
              alert('Maximum of 4 user zones allowed.');
          }
      }
  }

  function onMouseMove(e) {
      const mousePos = getMousePos(canvas, e);
    
      if (!isDragging) {
          // Update cursor style based on hover state
          const zoneInfo = getZoneAtPosition(mousePos);
          if (zoneInfo !== null) {
              canvas.classList.remove('crosshair');
              canvas.classList.add(zoneInfo.corner ? 'nwse-resize' : 'move');
          } else {
              canvas.classList.remove('move', 'nwse-resize');
              canvas.classList.add('crosshair');
          }
          return;
      }
      let dx = unscaleX(mousePos.x) - unscaleX(dragOffset.x);
      let dy = unscaleY(mousePos.y) - unscaleY(dragOffset.y);

      const zone = userZones[draggingZone];

      if (dragType === 'move') {
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
          if (newBeginY < 0) {
              dy += -newBeginY;
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
      } else if (dragType === 'resize') {
          adjustZoneCornerWithConstraints(zone, resizeCorner, dx, dy);
      } else if (dragType === 'create') {
          // Handle zone creation (ensure it stays within bounds)
          zone.endX = Math.max(-6000, Math.min(6000, unscaleX(mousePos.x)));
          zone.endY = Math.max(0, Math.min(7500, unscaleY(mousePos.y)));

          zone.endX = Math.round(zone.endX);
          zone.endY = Math.round(zone.endY);
      }

      dragOffset.x = mousePos.x;
      dragOffset.y = mousePos.y;

      drawVisualization();
      updateCoordinatesOutput();
  }

  function drawGrid() {
      const gridSize = 1000; // Grid every 1000 mm
      ctx.strokeStyle = '#e0e0e0';
      ctx.lineWidth = 1;

      // Vertical grid lines
      for (let x = -6000; x <= 6000; x += gridSize) {
          ctx.beginPath();
          ctx.moveTo(scaleX(x), scaleY(0));
          ctx.lineTo(scaleX(x), scaleY(7500));
          ctx.stroke();
      }

      // Horizontal grid lines
      for (let y = 0; y <= 7500; y += gridSize) {
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
          const { index } = zoneInfo;
          if (confirm(`Delete User Zone ${index + 1}?`)) {
              userZones.splice(index, 1);
              drawVisualization();
              updateCoordinatesOutput();
          }
      }
  }

  function adjustZoneCornerWithConstraints(zone, corner, dx, dy) {
      let newBeginX = zone.beginX;
      let newEndX = zone.endX;
      let newBeginY = zone.beginY;
      let newEndY = zone.endY;

      if (corner === 'top-left') {
          newBeginX += dx;
          newBeginY += dy;
          // Constrain to boundaries and not beyond opposite corner
          newBeginX = Math.max(-6000, Math.min(newBeginX, zone.endX));
          newBeginY = Math.max(0, Math.min(newBeginY, zone.endY));
      } else if (corner === 'top-right') {
          newEndX += dx;
          newBeginY += dy;
          newEndX = Math.min(6000, Math.max(newEndX, zone.beginX));
          newBeginY = Math.max(0, Math.min(newBeginY, zone.endY));
      } else if (corner === 'bottom-left') {
          newBeginX += dx;
          newEndY += dy;
          newBeginX = Math.max(-6000, Math.min(newBeginX, zone.endX));
          newEndY = Math.min(7500, Math.max(newEndY, zone.beginY));
      } else if (corner === 'bottom-right') {
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
      for (let i = userZones.length - 1; i >= 0; i--) {
          const zone = userZones[i];
          const x = scaleX(Math.min(zone.beginX, zone.endX));
          const y = scaleY(Math.min(zone.beginY, zone.endY));
          const width = Math.abs(scaleX(zone.endX) - scaleX(zone.beginX));
          const height = Math.abs(scaleY(zone.endY) - scaleY(zone.beginY));

          // Check for resize handles
          const handleSize = 8;
          const corners = [
              { x: x, y: y, corner: 'top-left' },
              { x: x + width, y: y, corner: 'top-right' },
              { x: x, y: y + height, corner: 'bottom-left' },
              { x: x + width, y: y + height, corner: 'bottom-right' },
          ];
          for (const corner of corners) {
              if (
                  pos.x >= corner.x - handleSize / 2 &&
                  pos.x <= corner.x + handleSize / 2 &&
                  pos.y >= corner.y - handleSize / 2 &&
                  pos.y <= corner.y + handleSize / 2
              ) {
                  return { index: i, corner: corner.corner };
              }
          }

          // Check if over zone
          if (pos.x >= x && pos.x <= x + width && pos.y >= y && pos.y <= y + height) {
              return { index: i, corner: null };
          }
      }
      return null;
  }

  // Update coordinates output
  const coordinatesOutput = document.getElementById('coordinatesOutput');

  function updateCoordinatesOutput() {
      let output = 'User Zones:\n';
      userZones.forEach((zone, index) => {
          output += `Zone ${index + 1} X Begin: ${zone.beginX}, X End: ${zone.endX}, Y Begin: ${zone.beginY}, Y End: ${zone.endY}\n`;
      });
      coordinatesOutput.textContent = output;
  }

  // Fetch data from the add-on's backend proxy
  async function fetchEntityState(entityId) {
      if (!entityId) {
          console.error('Attempted to fetch entity with undefined ID.');
          return null;
      }

      const response = await fetch(`api/entities/${entityId}`); // Added leading slash
      if (!response.ok) {
          throw new Error(`Failed to fetch entity ${entityId}: ${response.statusText}`);
      }
      return response.json();
  }

  // Variables for dark mode
  const darkModeToggle = document.getElementById('dark-mode-toggle');

  // Dark Mode Toggle with Persistence
  function setupDarkModeToggle() {
      // Check for saved user preference
      const savedMode = localStorage.getItem('darkMode');
      if (savedMode === 'enabled') {
          document.body.classList.add('dark-mode');
          darkModeToggle.textContent = 'Light Mode';
      }

      darkModeToggle.addEventListener('click', () => {
          document.body.classList.toggle('dark-mode');

          // Update button text based on mode
          if (document.body.classList.contains('dark-mode')) {
              darkModeToggle.textContent = 'Light Mode';
              localStorage.setItem('darkMode', 'enabled');
          } else {
              darkModeToggle.textContent = 'Dark Mode';
              localStorage.setItem('darkMode', 'disabled');
          }
      });
  }

  // Populate device selection drop-down
  async function fetchDevices() {
      const template = `
        {% set devices = namespace(list=[]) %}
            {% for device in states | map(attribute='entity_id') | map('device_id') | unique | reject('none') %}
                {% set model = device_attr(device, 'model') %}
                {% set manufacturer = device_attr(device, 'manufacturer') %}
                {% if manufacturer == 'EverythingSmartTechnology' %}
                    {% if model == 'Everything_Presence_Lite' %}
                        {% set devices.list = devices.list + [{'id': device, 'name': device_attr(device, 'name')}] %}
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
              console.error('Error parsing devices JSON:', e);
              alert('Failed to parse devices data.');
          }
      }
  }

  function populateDeviceDropdown(devices) {
      const deviceSelect = document.getElementById('device-select');
      deviceSelect.innerHTML = '<option value="" disabled selected>Select a device</option>';
  
      devices.forEach(device => {
          const option = document.createElement('option');
          option.value = device.id; // Set value to device ID
          option.textContent = device.name; // Display device name
          deviceSelect.appendChild(option);
      });
  }

  // Populate entity selection drop-down based on selected device
  async function populateEntityDropdown(deviceId) {
      const template = `
          {{ device_entities('${deviceId}') | tojson }}
      `;
      const result = await executeTemplate(template);
      if (result) {
          try {
              const entities = JSON.parse(result);
              // Filter required entities based on naming conventions
              const requiredEntities = filterRequiredEntities(entities);
              // Automatically select all required entities
              selectedEntities = requiredEntities.map(entityId => ({
                  id: entityId,
                  name: entityId // Optionally, map to friendly names if available
              }));

              if (selectedEntities.length === 0) {
                  alert('No relevant entities found for this device.');
                  return;
              }

              // Start live updating immediately
              startLiveRefresh();
          } catch (e) {
              console.error('Error parsing entities JSON:', e);
              alert('Failed to parse entities data.');
          }
      }
  }

  // Function to filter required entities based on naming conventions
  function filterRequiredEntities(entities) {
      const requiredSuffixes = [
          // Zone Coordinates
          'zone_1_begin_x',
          'zone_1_begin_y',
          'zone_1_end_x',
          'zone_1_end_y',
          'zone_2_begin_x',
          'zone_2_begin_y',
          'zone_2_end_x',
          'zone_2_end_y',
          'zone_3_begin_x',
          'zone_3_begin_y',
          'zone_3_end_x',
          'zone_3_end_y',
          'zone_4_begin_x',
          'zone_4_begin_y',
          'zone_4_end_x',
          'zone_4_end_y',

          // Target Tracking
          'target_1_active',
          'target_2_active',
          'target_3_active',

          // Target Coordinates and Attributes
          'target_1_x',
          'target_1_y',
          'target_1_speed',
          'target_1_resolution',
          'target_2_x',
          'target_2_y',
          'target_2_speed',
          'target_2_resolution',
          'target_3_x',
          'target_3_y',
          'target_3_speed',
          'target_3_resolution',

          // Target Angles and Distances
          'target_1_angle',
          'target_2_angle',
          'target_3_angle',
          'target_1_distance',
          'target_2_distance',
          'target_3_distance',

          // Zone Occupancy Off Delay
          'zone_1_occupancy_off_delay',
          'zone_2_occupancy_off_delay',
          'zone_3_occupancy_off_delay',
          'zone_4_occupancy_off_delay'
      ];

      return entities.filter(entityId => {
          return requiredSuffixes.some(suffix => entityId.endsWith(suffix));
      });
  }

// Handle device selection change
function handleDeviceSelection() {
  deviceSelect.addEventListener('change', async (event) => {
      const selectedDeviceId = event.target.value;
      if (selectedDeviceId) {
          await populateEntityDropdown(selectedDeviceId);
          targets = [];
          haZones = [];
          userZones = []; // Reset user zones if needed
          drawVisualization();
          updateCoordinatesOutput();
      }
  });
}


  // Live data fetching functions
  function setupRefreshRateControls() {
      setRefreshRateButton.addEventListener('click', () => {
          const newRate = parseInt(refreshRateInput.value, 10);
          if (isNaN(newRate) || newRate < 100) {
              alert('Please enter a valid refresh rate (minimum 100 ms).');
              return;
          }

          refreshInterval = newRate;
          if (refreshIntervalId !== null) {
              startLiveRefresh();
          }
      });

      stopRefreshButton.addEventListener('click', () => {
          stopLiveRefresh();
      });
  }

  function startLiveRefresh() {
      if (refreshIntervalId !== null) {
          clearInterval(refreshIntervalId);
      }

      if (selectedEntities.length === 0) {
          alert('No entities selected for live updating.');
          return;
      }

      fetchLiveData();

      refreshIntervalId = setInterval(fetchLiveData, refreshInterval);

      statusIndicator.textContent = `Status: Refreshing every ${refreshInterval} ms`;
  }

  function stopLiveRefresh() {
      if (refreshIntervalId !== null) {
          clearInterval(refreshIntervalId);
          refreshIntervalId = null;
          statusIndicator.textContent = 'Status: Not Refreshing';
      }
  }


  function reconstructZones(entities) {
      const zones = {};

      entities.forEach(entity => {
          const entityId = entity.entity_id;
          const match = entityId.match(/zone_(\d+)_(begin|end)_(x|y)$/);

          if (match) {
              const zoneNumber = match[1]; // e.g., '1' for zone_1
              const position = match[2];    // 'begin' or 'end'
              const axis = match[3];        // 'x' or 'y'

              if (!zones[zoneNumber]) {
                  zones[zoneNumber] = {};
              }

              // Assign values based on axis
              if (axis === 'x') {
                  if (position === 'begin') {
                      zones[zoneNumber].beginX = parseFloat(entity.state) || 0;
                  } else {
                      zones[zoneNumber].endX = parseFloat(entity.state) || 0;
                  }
              } else if (axis === 'y') {
                  if (position === 'begin') {
                      zones[zoneNumber].beginY = parseFloat(entity.state) || 0;
                  } else {
                      zones[zoneNumber].endY = parseFloat(entity.state) || 0;
                  }
              }
          }
      });

      // Convert zones object to an array
      const reconstructedZones = Object.keys(zones).map(zoneNumber => {
          const zone = zones[zoneNumber];
          return {
              beginX: zone.beginX || 0,
              beginY: zone.beginY || 0,
              endX: zone.endX || 0,
              endY: zone.endY || 0,
          };
      });

      return reconstructedZones;
  }

  function updateTargetTrackingInfo() {
      // Assuming targets array has 3 targets
      targets.forEach(target => {
          const targetNumber = target.number;
          if (targetNumber >= 1 && targetNumber <= 3) {
              document.getElementById(`target-${targetNumber}-status`).textContent = target.active ? 'Active' : 'Inactive';
              document.getElementById(`target-${targetNumber}-x`).textContent = target.x;
              document.getElementById(`target-${targetNumber}-y`).textContent = target.y;
              document.getElementById(`target-${targetNumber}-speed`).textContent = target.speed;
              document.getElementById(`target-${targetNumber}-resolution`).textContent = target.resolution;
              document.getElementById(`target-${targetNumber}-angle`).textContent = target.angle;
              document.getElementById(`target-${targetNumber}-distance`).textContent = target.distance;
          }
      });
  }

  async function fetchLiveData() {
      if (isFetchingData) {
          return;
      }
      isFetchingData = true;

      try {
          // Fetch data for all selected entities
          const dataPromises = selectedEntities.map(entity => fetchEntityState(entity.id));
          const entityStates = await Promise.all(dataPromises);

          // Reconstruct zones from entity states
          haZones = reconstructZones(entityStates);

          // Process targets based on entity states
          const targetNumbers = [1, 2, 3];
          const updatedTargets = targetNumbers.map(targetNumber => {
              // Find corresponding entities for the target
              const activeEntity = selectedEntities.find(entity => entity.id.endsWith(`target_${targetNumber}_active`));
              const xEntity = selectedEntities.find(entity => entity.id.endsWith(`target_${targetNumber}_x`));
              const yEntity = selectedEntities.find(entity => entity.id.endsWith(`target_${targetNumber}_y`));
              const speedEntity = selectedEntities.find(entity => entity.id.endsWith(`target_${targetNumber}_speed`));
              const resolutionEntity = selectedEntities.find(entity => entity.id.endsWith(`target_${targetNumber}_resolution`));
              const angleEntity = selectedEntities.find(entity => entity.id.endsWith(`target_${targetNumber}_angle`));
              const distanceEntity = selectedEntities.find(entity => entity.id.endsWith(`target_${targetNumber}_distance`));

              // Extract data from entityStates
              const activeData = entityStates.find(entity => entity.entity_id === activeEntity.id);
              const xData = entityStates.find(entity => entity.entity_id === xEntity.id);
              const yData = entityStates.find(entity => entity.entity_id === yEntity.id);
              const speedData = entityStates.find(entity => entity.entity_id === speedEntity.id);
              const resolutionData = entityStates.find(entity => entity.entity_id === resolutionEntity.id);
              const angleData = entityStates.find(entity => entity.entity_id === angleEntity.id);
              const distanceData = entityStates.find(entity => entity.entity_id === distanceEntity.id);

              return {
                  number: targetNumber,
                  active: activeData && activeData.state === 'on',
                  x: xData ? parseFloat(xData.state) || 0 : 0,
                  y: yData ? parseFloat(yData.state) || 0 : 0,
                  speed: speedData ? parseFloat(speedData.state) || 0 : 0,
                  resolution: resolutionData ? resolutionData.state : 'N/A',
                  angle: angleData ? parseFloat(angleData.state) || 0 : 0,
                  distance: distanceData ? parseFloat(distanceData.state) || 0 : 0,
              };
          });

          targets = updatedTargets;

          // Draw the visualization
          drawVisualization();
          updateCoordinatesOutput();

          // Update Target Tracking Info Box
          updateTargetTrackingInfo();
      } catch (error) {
          console.error('Error fetching live data:', error);
          statusIndicator.textContent = 'Status: Error Fetching Data';
      } finally {
          isFetchingData = false;
      }
  }

  // Initialize the application
  async function init() {
      await fetchDevices(); // Fetch and populate devices
      handleDeviceSelection();
      setupDarkModeToggle();
      setupRefreshRateControls();
  }

  async function executeTemplate(template) {
      try {
          const response = await fetch('api/template', {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/json'
              },
              body: JSON.stringify({ template })
          });

          if (!response.ok) {
              const errorData = await response.json();
              throw new Error(errorData.error || 'Failed to execute template');
          }

          const result = await response.text();
          return result;
      } catch (error) {
          console.error('Error executing template:', error);
          alert(`Error executing template: ${error.message}`);
      }
  }

  async function saveZonesToHA() {
    if (!selectedEntities || selectedEntities.length === 0) {
      alert('No entities loaded. Please select a valid device.');
      return;
    }

    // Ensure we have entities for all zones (4 zones, each with begin_x, begin_y, end_x, end_y)
    const zoneEntities = extractZoneEntities(selectedEntities);
    if (Object.keys(zoneEntities).length === 0) {
      alert('Failed to find zone entities.');
      return;
    }
    const zonesToSave = [];

    for (let i = 0; i < 4; i++) {
      if (userZones[i]) {
        zonesToSave.push({
          beginX: userZones[i].beginX || 0,
          endX: userZones[i].endX || 0,
          beginY: userZones[i].beginY || 0,
          endY: userZones[i].endY || 0
        });
      } else {
        zonesToSave.push({
          beginX: 0,
          endX: 0,
          beginY: 0,
          endY: 0
        });
      }
    }

    // Send the zones data to Home Assistant
    try {
      for (let i = 0; i < zonesToSave.length; i++) {
        const zone = zonesToSave[i];
        await saveZoneToHA(i + 1, zone, zoneEntities);
      }

      alert('Zones saved successfully!');
    } catch (error) {
      console.error('Error saving zones:', error);
      alert('Failed to save zones.');
    }
  }

  function extractZoneEntities(entities) {
    const zoneEntities = {};

    // Iterate through entities and map each relevant zone entity to its exact match
    entities.forEach(entity => {
      const entityId = entity.id;

      if (entityId.includes('zone_1_begin_x')) zoneEntities.zone_1_begin_x = entityId;
      if (entityId.includes('zone_1_begin_y')) zoneEntities.zone_1_begin_y = entityId;
      if (entityId.includes('zone_1_end_x')) zoneEntities.zone_1_end_x = entityId;
      if (entityId.includes('zone_1_end_y')) zoneEntities.zone_1_end_y = entityId;

      if (entityId.includes('zone_2_begin_x')) zoneEntities.zone_2_begin_x = entityId;
      if (entityId.includes('zone_2_begin_y')) zoneEntities.zone_2_begin_y = entityId;
      if (entityId.includes('zone_2_end_x')) zoneEntities.zone_2_end_x = entityId;
      if (entityId.includes('zone_2_end_y')) zoneEntities.zone_2_end_y = entityId;

      if (entityId.includes('zone_3_begin_x')) zoneEntities.zone_3_begin_x = entityId;
      if (entityId.includes('zone_3_begin_y')) zoneEntities.zone_3_begin_y = entityId;
      if (entityId.includes('zone_3_end_x')) zoneEntities.zone_3_end_x = entityId;
      if (entityId.includes('zone_3_end_y')) zoneEntities.zone_3_end_y = entityId;

      if (entityId.includes('zone_4_begin_x')) zoneEntities.zone_4_begin_x = entityId;
      if (entityId.includes('zone_4_begin_y')) zoneEntities.zone_4_begin_y = entityId;
      if (entityId.includes('zone_4_end_x')) zoneEntities.zone_4_end_x = entityId;
      if (entityId.includes('zone_4_end_y')) zoneEntities.zone_4_end_y = entityId;
    });

    return zoneEntities;
  }

  async function saveZoneToHA(zoneNumber, zone, zoneEntities) {
    const baseUrl = 'api/states/';

    const zonePrefix = `zone_${zoneNumber}`;
    const requests = [
      fetch(`${baseUrl}${zoneEntities[`${zonePrefix}_begin_x`]}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: Math.round(zone.beginX.toString()) })
      }),
      fetch(`${baseUrl}${zoneEntities[`${zonePrefix}_end_x`]}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: Math.round(zone.endX.toString()) })
      }),
      fetch(`${baseUrl}${zoneEntities[`${zonePrefix}_begin_y`]}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: Math.round(zone.beginY.toString()) })
      }),
      fetch(`${baseUrl}${zoneEntities[`${zonePrefix}_end_y`]}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: Math.round(zone.endY.toString()) })
      })
    ];

    await Promise.all(requests);
  }

  // Start the application
  init();
});
