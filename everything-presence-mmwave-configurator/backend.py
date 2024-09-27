from flask import Flask, jsonify, request, Response
import requests
import os
import logging
import threading

# Configure logging
#logging.basicConfig(level=logging.DEBUG)

app = Flask(__name__)

SUPERVISOR_TOKEN = os.getenv('SUPERVISOR_TOKEN')

HOME_ASSISTANT_API = 'http://supervisor/core/api'

headers = {
    'Authorization': f'Bearer {SUPERVISOR_TOKEN}',
    'Content-Type': 'application/json',
}

def check_connectivity():
    """Function to check connectivity with Home Assistant API."""
    if not SUPERVISOR_TOKEN:
        logging.error("Cannot perform connectivity check without Supervisor token.")
        return
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
    
@app.route('/api/states/<entity_id>', methods=['POST'])
def save_zone(entity_id):
    try:
        zone_data = request.json
        state_value = zone_data.get('state')
        response = requests.post(f'{HOME_ASSISTANT_API}/states/{entity_id}', headers=headers, json={"state": state_value})
        if response.status_code == 200:
            return jsonify({"message": f"Zone entity {entity_id} updated successfully."}), 200
        else:
            return jsonify({"error": f"Failed to update entity {entity_id}.", "details": response.text}), response.status_code

    except Exception as e:
        return jsonify({"error": "An error occurred while saving the zone.", "details": str(e)}), 500

if __name__ == '__main__':
    threading.Thread(target=check_connectivity).start()
    app.run(host='0.0.0.0', port=5000)
