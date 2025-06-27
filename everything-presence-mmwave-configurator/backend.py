#!/usr/bin/env python3

from flask import Flask, jsonify, request, Response
from flask_sock import Sock
import requests
import os
import logging
import threading
import sys
import time
import json

# Configure logging
logging.basicConfig(level=logging.ERROR)  # Set global logging level to ERROR
log = logging.getLogger('werkzeug')
log.setLevel(logging.ERROR)  # Suppress Werkzeug request logs

app = Flask(__name__)
app.config['SECRET_KEY'] = 'everything-presence-configurator-secret'
sock = Sock(app)

SUPERVISOR_TOKEN = os.getenv('SUPERVISOR_TOKEN')
HA_URL = os.getenv('HA_URL')
HA_TOKEN = os.getenv('HA_TOKEN')

if SUPERVISOR_TOKEN:
    logging.error('Running as a Home Assistant Add-on.')
    HOME_ASSISTANT_API = 'http://supervisor/core/api'
    headers = {
        'Authorization': f'Bearer {SUPERVISOR_TOKEN}',
        'Content-Type': 'application/json',
    }
elif HA_URL and HA_TOKEN:
    logging.error('Running as a standalone docker container.')
    HOME_ASSISTANT_API = HA_URL.rstrip('/') + '/api'
    headers = {
        'Authorization': f'Bearer {HA_TOKEN}',
        'Content-Type': 'application/json',
    }
else:
    logging.error('No SUPERVISOR_TOKEN found and no HA_URL and HA_TOKEN provided.')
    sys.exit(1)

def check_connectivity():
    """Function to check connectivity with Home Assistant API."""
    try:
        logging.info("Checking connectivity with Home Assistant API...")
        response = requests.get(f'{HOME_ASSISTANT_API}/', headers=headers, timeout=10)
        if response.status_code == 200:
            logging.info("Successfully connected to Home Assistant API.")
        else:
            logging.error(f"Failed to connect to Home Assistant API. Status Code: {response.status_code}")
            logging.error(f"Response: {response.text}")
    except requests.exceptions.RequestException as e:
        logging.error(f"Exception occurred while connecting to Home Assistant API: {e}")
    
    logging.info("✅ Flask backend initialized successfully")

@app.route('/api/template', methods=['POST'])
def execute_template():
    """
    Endpoint to execute a Jinja2 template by forwarding it to Home Assistant's /api/template endpoint.
    It acts as a proxy, forwarding the template and returning the rendered result.
    """
    data = request.get_json()
    template = data.get('template')
    if not template:
        return jsonify({"error": "No template provided"}), 400

    try:
        response = requests.post(
            f'{HOME_ASSISTANT_API}/template',
            headers=headers,
            json={"template": template},
            timeout=10
        )

        if response.status_code == 200:
            return Response(response.content, status=200, content_type=response.headers.get('Content-Type', 'application/json'))
        else:
            logging.error(f"Failed to execute template. Status Code: {response.status_code}")
            logging.error(f"Response: {response.text}")
            return jsonify({"error": "Failed to execute template"}), response.status_code
    except Exception as e:
        logging.error(f"Exception occurred while executing template: {e}")
        return jsonify({"error": "Exception occurred while executing template"}), 500

@app.route('/api/entities/<entity_id>', methods=['GET'])
def get_entity_state(entity_id):
    """
    Endpoint to get the state of a specific entity.
    """
    response = requests.get(f'{HOME_ASSISTANT_API}/states/{entity_id}', headers=headers)
    if response.status_code == 200:
        return jsonify(response.json())
    else:
        return jsonify({'error': 'Unauthorized or entity not found'}), response.status_code
    
@app.route('/api/services/number/set_value', methods=['POST'])
def set_value():
    try:
        data = request.json
        entity_id = data.get('entity_id')
        value = data.get('value')

        if not entity_id or value is None:
            return jsonify({"error": "Missing entity_id or value"}), 400

        payload = {
            "entity_id": entity_id,
            "value": value
        }
        
        # Make the POST request to Home Assistant API
        response = requests.post(f'{HOME_ASSISTANT_API}/services/number/set_value', headers=headers, json=payload)

        if response.status_code == 200:
            return jsonify({"message": f"Entity {entity_id} updated successfully."}), 200
        else:
            return jsonify({"error": f"Failed to update entity {entity_id}.", "details": response.text}), response.status_code

    except Exception as e:
        return jsonify({"error": "An error occurred while setting the value.", "details": str(e)}), 500

# Removed unused /api/supervisor/token route - no longer needed with backend WebSocket proxy

# Removed unused /api/test-websocket route - debugging endpoint no longer needed

# Global set to store currently selected entities for WebSocket filtering
selected_entity_ids = set()

@app.route('/api/selected-entities', methods=['POST'])
def set_selected_entities():
    """Set the list of entities that the frontend is currently interested in"""
    global selected_entity_ids
    try:
        data = request.get_json()
        entity_ids = data.get('entity_ids', [])
        selected_entity_ids = set(entity_ids)
        logging.info(f"Updated selected entities: {len(selected_entity_ids)} entities for device")
        return jsonify({'success': True, 'count': len(selected_entity_ids)})
    except Exception as e:
        logging.error(f"Error setting selected entities: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/selected-entities', methods=['GET'])
def get_selected_entities():
    """Get the current list of selected entities"""
    global selected_entity_ids
    return jsonify({'entity_ids': list(selected_entity_ids), 'count': len(selected_entity_ids)})

def is_mmwave_entity(entity_id):
    """Check if an entity is related to mmWave sensors using the same logic as frontend"""
    if not entity_id:
        return False
    
    # Use the same required suffixes as the frontend filterRequiredEntities function
    required_suffixes = [
        # Zone Coordinates
        "zone_1_begin_x", "zone_1_begin_y", "zone_1_end_x", "zone_1_end_y",
        "zone_2_begin_x", "zone_2_begin_y", "zone_2_end_x", "zone_2_end_y", 
        "zone_3_begin_x", "zone_3_begin_y", "zone_3_end_x", "zone_3_end_y",
        "zone_4_begin_x", "zone_4_begin_y", "zone_4_end_x", "zone_4_end_y",
        
        # Target Tracking
        "target_1_active", "target_2_active", "target_3_active",
        
        # Target Coordinates and Attributes  
        "target_1_x", "target_1_y", "target_1_speed", "target_1_resolution",
        "target_2_x", "target_2_y", "target_2_speed", "target_2_resolution", 
        "target_3_x", "target_3_y", "target_3_speed", "target_3_resolution",
        
        # Target Angles and Distances
        "target_1_angle", "target_2_angle", "target_3_angle",
        "target_1_distance", "target_2_distance", "target_3_distance",
        
        # Zone Occupancy Off Delay
        "zone_1_occupancy_off_delay", "zone_2_occupancy_off_delay", 
        "zone_3_occupancy_off_delay", "zone_4_occupancy_off_delay",
        
        # Configured Values
        "max_distance", "installation_angle",
        
        # Occupancy Masks (Exclusion Zones)
        "occupancy_mask_1_begin_x", "occupancy_mask_1_begin_y", 
        "occupancy_mask_1_end_x", "occupancy_mask_1_end_y",
        "occupancy_mask_2_begin_x", "occupancy_mask_2_begin_y",
        "occupancy_mask_2_end_x", "occupancy_mask_2_end_y",
    ]
    
    return any(entity_id.endswith(suffix) for suffix in required_suffixes)

@sock.route('/ws')
def websocket_proxy(ws):
    """WebSocket proxy to Home Assistant WebSocket API"""
    import websocket
    import json
    import threading
    import queue
    
    logging.info("WebSocket client connected - starting HA proxy")
    
    # Store selected entities that the frontend requires
    selected_entity_ids = set()
    
    # Create communication queues
    to_ha_queue = queue.Queue()
    from_ha_queue = queue.Queue()
    ha_ws = None
    proxy_active = True
    
    def ha_on_open(ha_ws_instance):
        logging.info("Connected to HA WebSocket, sending auth")
        supervisor_token = os.environ.get('SUPERVISOR_TOKEN')
        if supervisor_token:
            auth_message = {
                "type": "auth",
                "access_token": supervisor_token
            }
            ha_ws_instance.send(json.dumps(auth_message))
    
    def ha_on_message(ha_ws_instance, message):
        # Filter and forward HA messages to frontend
        try:
            # Parse message
            import json
            data = json.loads(message) if isinstance(message, str) else message
            
            # Handle authentication
            if data.get('type') == 'auth_required':
                logging.info("HA requested auth - sending supervisor token")
                return
            elif data.get('type') == 'auth_ok':
                logging.info("✅ HA WebSocket authenticated successfully - proxy ready")
                return
            elif data.get('type') == 'auth_invalid':
                logging.error("❌ HA WebSocket authentication failed")
                return
            
            # Filter state results to only selected device entities
            if data.get('type') == 'result' and isinstance(data.get('result'), list):
                # Get the global selected entities set
                global selected_entity_ids
                
                # Filter entities to only include the ones selected by frontend
                filtered_entities = []
                for entity in data.get('result', []):
                    entity_id = entity.get('entity_id', '')
                    if entity_id in selected_entity_ids:
                        filtered_entities.append(entity)
                
                if filtered_entities:
                    # Send filtered result
                    filtered_data = data.copy()
                    filtered_data['result'] = filtered_entities
                    from_ha_queue.put(json.dumps(filtered_data))
                    logging.info(f"Filtered to {len(filtered_entities)} selected entities from {len(data.get('result', []))} total")
                return
            
            # Filter state_changed events to only selected device entities
            if (data.get('type') == 'event' and 
                data.get('event', {}).get('event_type') == 'state_changed'):
                entity_id = data.get('event', {}).get('data', {}).get('entity_id', '')
                if entity_id in selected_entity_ids:
                    from_ha_queue.put(message)
                return
            
            # Forward other message types
            if data.get('type') in ['result']:
                from_ha_queue.put(message)
                
        except Exception as e:
            logging.error(f"Error filtering HA message: {e}")
            from_ha_queue.put(message)
    
    def ha_on_error(ha_ws_instance, error):
        logging.error(f"HA WebSocket error: {error}")
    
    def ha_on_close(ha_ws_instance, close_status_code, close_msg):
        logging.error(f"HA WebSocket closed: {close_status_code} - {close_msg}")
        nonlocal proxy_active
        proxy_active = False
    
    # Start HA WebSocket connection
    ha_ws = websocket.WebSocketApp('ws://supervisor/core/websocket',
                                   on_open=ha_on_open,
                                   on_message=ha_on_message,
                                   on_error=ha_on_error,
                                   on_close=ha_on_close)
    
    # Start HA WebSocket in background thread
    ha_thread = threading.Thread(target=ha_ws.run_forever)
    ha_thread.daemon = True
    ha_thread.start()
    
    # Forward messages from frontend to HA
    def forward_to_ha():
        while proxy_active and ha_thread.is_alive():
            try:
                message = to_ha_queue.get(timeout=1)
                if ha_ws and ha_ws.sock and ha_ws.sock.connected:
                    ha_ws.send(message)

                    
                    # Track entity subscriptions to know which entities frontend wants
                    try:
                        data = json.loads(message) if isinstance(message, str) else message
                        if data.get('type') == 'get_states':
                            logging.info("Frontend requested initial states - will filter to device entities")
                    except:
                        pass
                        
            except queue.Empty:
                continue
            except Exception as e:
                logging.error(f"Error forwarding to HA: {e}")
                break
    
    # Start forwarding thread
    forward_thread = threading.Thread(target=forward_to_ha)
    forward_thread.daemon = True
    forward_thread.start()
    
    try:
        # Main proxy loop
        while proxy_active:
            # Send queued messages from HA to frontend
            try:
                while not from_ha_queue.empty():
                    ha_message = from_ha_queue.get_nowait()
                    ws.send(ha_message)

            except queue.Empty:
                pass
            except Exception as e:
                logging.error(f"Error sending to frontend: {e}")
                break
            
            # Receive messages from frontend
            try:
                frontend_message = ws.receive(timeout=0.1)
                if frontend_message:
                    to_ha_queue.put(frontend_message)

            except Exception as e:
                if "timeout" not in str(e).lower():
                    logging.error(f"Error receiving from frontend: {e}")
                    break
    
    except Exception as e:
        logging.error(f"WebSocket proxy error: {e}")
    
    finally:
        # Cleanup
        proxy_active = False
        if ha_ws:
            ha_ws.close()
        logging.info("WebSocket proxy connection closed")

if __name__ == '__main__':
    logging.error("Starting REST API server with direct HA WebSocket support from frontend")
    
    # Start connectivity check
    threading.Thread(target=check_connectivity).start()
    
    # Run simple Flask server
    logging.error("Starting Flask server on port 5000")
    logging.error("Available routes:")
    for rule in app.url_map.iter_rules():
        logging.error(f"  {rule.endpoint}: {rule.methods} {rule.rule}")
    logging.error("About to start app.run() - Flask should be accessible on port 5000")
    app.run(host='0.0.0.0', port=5000, debug=False)
