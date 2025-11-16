// Simple zones serializer to match current export/import format

export function serializeZones(userZones, exclusionZones, entryZones) {
  const sanitize = (z) => {
    const src = z || {};
    return {
      beginX: Number(src.beginX) || 0,
      endX: Number(src.endX) || 0,
      beginY: Number(src.beginY) || 0,
      endY: Number(src.endY) || 0,
    };
  };
  return {
    userZones: (userZones || []).map(sanitize),
    exclusionZones: (exclusionZones || []).map(sanitize),
    entryZones: (entryZones || []).map(sanitize),
  };
}

export function deserializeZones(obj) {
  const toZone = (r) => {
    if (!r) return null;
    return {
      beginX: Number(r.beginX) || 0,
      endX: Number(r.endX) || 0,
      beginY: Number(r.beginY) || 0,
      endY: Number(r.endY) || 0,
    };
  };
  return {
    userZones: (obj.userZones || []).map(toZone),
    exclusionZones: (obj.exclusionZones || []).map(toZone),
    entryZones: (obj.entryZones || []).map(toZone),
  };
}
