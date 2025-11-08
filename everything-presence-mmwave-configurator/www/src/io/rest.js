const API_BASE = 'api';

export async function fetchEntityState(entityId) {
  if (!entityId) {
    console.error('Attempted to fetch entity with undefined ID.');
    return null;
  }
  try {
    const response = await fetch(`${API_BASE}/entities/${entityId}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch entity ${entityId}: ${response.status} ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`Error fetching entity ${entityId}:`, error);
    return null;
  }
}

export { API_BASE };

