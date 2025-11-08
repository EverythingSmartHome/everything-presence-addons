// Shared models (JSDoc typedefs to aid editors)

/** @typedef {'regular'|'exclusion'|'entry'} ZoneKind */

/**
 * @typedef {Object} Rect
 * @property {'rect'} type
 * @property {number} x1
 * @property {number} y1
 * @property {number} x2
 * @property {number} y2
 */

/**
 * @typedef {Object} Poly
 * @property {'poly'} type
 * @property {{x:number,y:number}[]} points
 */

/**
 * @typedef {Object} Zone
 * @property {string} id
 * @property {ZoneKind} kind
 * @property {Rect|Poly} shape
 * @property {'HA'|'User'} source
 * @property {string=} label
 * @property {{ thresholdPct?: number, timeoutMs?: number }=} config
 */

/**
 * @typedef {Object} RoomObject
 * @property {string} id
 * @property {'wall'|'door'|'furniture'} type
 * @property {Rect|Poly} shape
 * @property {string=} label
 */

/**
 * @typedef {Object} SceneJSON
 * @property {{version:1, saved_at?:string}=} meta
 * @property {Zone[]} userZones
 * @property {Zone[]} exclusionZones
 * @property {Zone[]=} entryZones
 * @property {RoomObject[]=} room
 * @property {{ theme?: 'auto'|'light'|'dark', grid?: number }=} styling
 */

export {}; // types only

