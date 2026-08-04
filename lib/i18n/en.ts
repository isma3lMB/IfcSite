/**
 * English — a lift of the strings from the original single-file page.
 *
 * This object is the shape of record: `Dict = typeof en`, and fr.ts is declared
 * as a Dict, so a key added here and forgotten there is a compile error.
 */
export const en = {
  /* ---- chrome ---- */
  'app.title': 'IFC Site — site context to IFC',
  'app.description':
    'Draw a rectangle on a map and get a georeferenced IFC4 file of the buildings, roads and terrain inside it — entirely in the browser.',
  'app.wordmark': 'IFC Site',
  'app.tag': 'No server · runs in this tab',
  'app.h1a': 'IFC',
  'app.h1b': 'Site',
  'app.sub':
    'Draw a rectangle on the map. It pulls the buildings and roads inside it, extrudes them, and writes a georeferenced IFC4 file — entirely in the browser.',
  'app.badge': 'LOD1 massing\nIfcBuildingElementProxy\nLoGeoRef 50',
  'app.langLabel': 'Language',

  /* ---- shell chrome. The viewers are full-bleed and everything else floats
     over them, so these label controls that have no room for prose. ---- */
  'ui.info': 'About this tool',
  'ui.close': 'Close',
  'ui.options': 'Options',
  'ui.collapse': 'Hide options',
  'ui.expand': 'Show options',
  'ui.originMarker': 'Show the model origin',

  /* ---- flow bar: one step, one next action ---- */
  'flow.stepDraw': 'Draw',
  'flow.stepBuild': 'Build',
  'flow.stepExport': 'Export',
  'flow.mode': 'Map mode',
  'flow.draw': 'Draw',
  'flow.pan': 'Pan',
  'flow.redraw': 'Redraw',
  'flow.rebuild': 'Rebuild sheet',
  'flow.stale': 'Site moved since the last build — rebuild before exporting.',

  /* ---- controls ---- */
  'ctl.findPlace': 'Find a place',
  'ctl.findPlacePlaceholder': 'Street, town, postcode…',
  'ctl.siteExtent': 'Site extent',
  'ctl.rectangle': 'Rectangle',
  'ctl.drawOnMap': 'draw one on the map',
  'ctl.siteHint':
    'Click two opposite corners on the map — or drag to sweep it out in one go. Drag the corners to resize it, the rectangle itself to move it.',
  'ctl.drawSite': 'Draw site',
  'ctl.zoomSite': 'Zoom to site',
  'ctl.crs': 'Projected CRS',
  'ctl.crsAuto': 'Auto UTM / WGS84',
  'ctl.defaultHeight': 'Height when untagged',
  'ctl.dataSource': 'Data source',
  'ctl.sourceOsm': 'OpenStreetMap + Terrarium — worldwide',
  'ctl.sourceIgn': 'IGN Géoplateforme — France',
  'ctl.include': 'Include',
  'ctl.roads': 'Road surfaces',
  'ctl.terrain': 'Terrain mesh',
  'ctl.terrainSrcOsm': 'Terrarium ~30 m',
  'ctl.terrainSrcIgn': 'RGE ALTI ~1 m',
  'ctl.trees': 'Individual trees',
  'ctl.accuracy': 'Terrain accuracy',
  'ctl.accuracyCoarse': 'Coarse — 30 m cells',
  'ctl.accuracyStandard': 'Standard — 15 m cells',
  'ctl.accuracyFine': 'Fine — 5 m cells',
  'ctl.accuracyMax': 'Maximum — 1 m cells',
  /* The target is a request, not a promise: a big site runs out of point budget
     long before 1 m, so the dock reports what the grid will actually be. */
  'ctl.accuracyCell': '{n}×{n} · ~{m} m',
  'ctl.accuracyHint': 'Denser sampling is slower to fetch and heavier to export.',
  'ctl.veg': 'Vegetation and hedges',
  'ctl.water': 'Water surfaces',
  'ctl.parcels': 'Cadastral parcels',
  'ctl.build': 'Build sheet',
  'ctl.building': 'Building…',
  'ctl.download': 'Download IFC',

  /* ---- sheet ---- */
  'sheet.tabMap': '2D map',
  'sheet.tab3d': '3D preview',
  'sheet.origin': 'origin —',
  'sheet.hudLegend': 'yellow = tagged height · grey = estimated',
  'sheet.hudHint': 'click a building to edit · drag to orbit · scroll to zoom · shift-drag to pan',

  /* ---- readout ---- */
  'read.buildings': 'Buildings',
  'read.tagged': 'Tagged height',
  'read.roadFaces': 'Road faces',
  'read.trees': 'Trees',
  'read.layers': 'Layers',
  'read.entities': 'Entities',
  'read.file': 'File',
  'unit.kb': 'kB',
  'unit.mb': 'MB',
  /* French typography puts a space before the percent sign; English does not. */
  'unit.percent': '{v}%',

  /* ---- element editor ---- */
  'ed.selected': 'Selected element',
  'ed.empty': 'Click a building in the 3D preview to edit it.',
  'ed.gizmo': 'Gizmo',
  'ed.move': 'Move',
  'ed.rotate': 'Rotate',
  'ed.scale': 'Scale',
  'ed.colour': 'Colour',
  'ed.defaultColour': 'Default colour',
  'ed.position': 'Position offset (m)',
  'ed.rotation': 'Rotation (°)',
  'ed.scaleLabel': 'Scale',
  'ed.lockProportions': 'Lock proportions',
  'ed.resetElement': 'Reset element',
  'ed.deselect': 'Deselect',
  'ed.undo': 'Undo (Ctrl+Z)',
  'ed.redo': 'Redo (Ctrl+Shift+Z)',
  'ed.close': 'Deselect (Esc)',
  'ed.hint':
    'W / E / R switch gizmo · Esc deselects · Ctrl+Z and Ctrl+Shift+Z step through history. Edits are written into the downloaded IFC.',
  'ed.originName': 'Model origin',
  'ed.originPosition': 'Offset from site centre (m)',
  'ed.resetOrigin': 'Recentre origin',
  'ed.originHint':
    'This is the point the exported IFC uses as (0, 0, 0). Moving it re-bases the file without moving anything on the ground — the georeferencing follows it.',
  'ed.projectPlacement': 'Local project placement',
  'ed.projectCoords': 'Coordinates of this point (m)',
  'ed.projectAngle': 'Angle — °counter-clockwise from grid east',
  'ed.resetPlacement': 'Reset placement',
  'ed.projectHint':
    'Give the origin point the coordinates your project works in, and turn the axes to its grid. This becomes the site placement in the IFC; the georeferencing is unchanged, so everything still lands where it does on the map. Typed here, not dragged — these two fields are outside the undo history.',

  /* ---- status ---- */
  'status.ready': 'Ready. Click two opposite corners on the map to set your site.',
  'status.queryingOverpass': 'Querying Overpass…',
  'status.queryingTrees': 'Querying OSM trees…',
  'status.fetchingIgnBuildings': 'Fetching IGN BD TOPO buildings…',
  'status.fetchingIgnRoads': 'Fetching IGN BD TOPO roads…',
  'status.fetchingIgnLayer': 'Fetching IGN {layer}…',
  'status.samplingAlti': 'Sampling IGN RGE ALTI…',
  'status.samplingAltiChunk': 'Sampling IGN RGE ALTI — batch {done} of {total}…',
  'status.readingTerrainTile': 'Reading elevation tiles…',
  'status.terrainUnavailable':
    'Terrain unavailable ({detail}) — continuing on a flat datum.',
  'status.datumUnavailable':
    'Site elevation unavailable ({detail}) — continuing at zero, without altitudes.',
  'status.siteClamped': 'Site clamped to {min}–{max} m a side.',
  'status.siteSet': 'Site is {w} × {h} m — build the sheet.',
  'status.drawPrompt': 'Click two opposite corners to set the site. Esc switches to pan.',
  'status.drawModeOff': 'Pan mode — drag to move the map.',
  'status.drawCancelled': 'Drawing cancelled.',
  'status.cornerSet': 'Corner set — click the opposite corner. Esc cancels.',
  'status.noSiteYet': 'No site yet — click two opposite corners on the map.',
  'status.editCommitted': '{label} — {name}. Ctrl+Z to undo.',
  'status.undone': 'Undone: {label} — {name}.',
  'status.redone': 'Redone: {label} — {name}.',
  'status.searchUnavailable': 'Place search unavailable ({detail}) — pan the map instead.',

  /* ---- build summary, composed from BuildSummary ---- */
  'sum.built':
    'Built {buildings} buildings from {provider} — {tagged} with {kind} heights, {estimated} estimated at {fallback} m.',
  'sum.kindSurveyed': 'surveyed',
  'sum.kindTagged': 'tagged',
  'sum.capped': 'Capped at {cap}; draw a smaller rectangle to see the rest.',
  'sum.treesCapped': 'Trees capped at {cap}.',
  'sum.skipped': 'No {layers} returned.',

  /* ---- layer names (UI only; the IFC keeps stable English names) ---- */
  'layer.vegetation': 'vegetation',
  'layer.hedges': 'hedges',
  'layer.water': 'water',
  'layer.parcels': 'parcels',
  'layer.trees': 'trees',

  /* ---- undo-stack command names ---- */
  'edit.move': 'Move',
  'edit.rotate': 'Rotate',
  'edit.scale': 'Scale',
  'edit.colour': 'Colour',
  'edit.colourReset': 'Colour reset',
  'edit.reset': 'Reset element',
  'edit.origin': 'Move origin',
  'edit.originReset': 'Origin recentred',

  /* ---- errors ---- */
  'err.overpassAllRefused': 'Every Overpass mirror refused the request.',
  'err.overpassTimeout': '{host} timed out',
  'err.overpassStatus': '{host} returned {status}',
  'err.ignWfsStatus': 'IGN {layer} returned {status}',
  'err.altiStatus': 'RGE ALTI returned {status}',
  'err.altiShortGrid': 'RGE ALTI returned a short grid',
  'err.altiOutsideCoverage': 'outside RGE ALTI coverage',
  'err.altiGridTooLarge': 'elevation grid too large',
  'err.terrainTileBlocked': 'terrain tile blocked',
  'err.nominatimStatus': 'Nominatim returned {status}',
  'err.ignOutsideFrance':
    'IGN only covers metropolitan France, and this rectangle reaches outside it. Switch the data source to OpenStreetMap, or move the site.',
  'err.noBuildingsIgn':
    'IGN returned no buildings here. Outside France, switch the data source to OpenStreetMap; inside it, draw a larger rectangle.',
  'err.noBuildingsOsm':
    'No buildings mapped inside that rectangle. Draw a larger one, or pick a denser area.',
  'err.noSite': 'Draw a site rectangle on the map first.',

  /* ---- notes. `body` marks code spans with backticks. ---- */
  notes: [
    {
      title: 'What runs where.',
      body: 'Everything is client side. Overpass sends `Access-Control-Allow-Origin: *`, so the browser can query it directly, and the IFC is serialised in JavaScript and handed to a Blob URL. No backend touches your data.',
    },
    {
      title: 'Winding.',
      body: 'OSM footprints come in both directions. IFC profiles need counter-clockwise outer curves, so every ring is checked by signed area and reversed if needed — skip this and roughly half your buildings render inverted or vanish.',
    },
    {
      title: 'Georeferencing.',
      body: 'Written as `IfcMapConversion` + `IfcProjectedCRS`. `Scale` is 1.0, which is fine at this extent; over several kilometres substitute the real combined grid factor or your model will disagree with the surveyor’s.',
    },
    {
      title: 'Drawing the site.',
      body: 'The rectangle you place on the OpenStreetMap basemap — two corner clicks, or one drag — is the whole site definition. Nothing is selected until you draw it: its bounds go to Overpass and the IGN WFS as a bbox, size the terrain grid, and clip every polygon that crosses the edge. It is a WGS84 rectangle, so in a projected CRS it is very slightly rotated by grid convergence; the local clip box is taken from the outermost corner so nothing you drew is cropped. Sides are held between 100 m and 2000 m — past that Overpass and the WFS start refusing. Basemap tiles and the place search come from OpenStreetMap and Nominatim; both are free services, so keep the requests light.',
    },
    {
      title: 'Two providers.',
      body: 'OpenStreetMap works anywhere but guesses height from `building:levels × 3` and then a constant. Inside France, IGN Géoplateforme serves BD TOPO with a surveyed `hauteur` on nearly every building, plus vegetation, water and cadastral parcels — and `data.geopf.fr` sends `Access-Control-Allow-Origin: *` with no API key, so it stays as server-free as Overpass. Individual trees are the exception: BD TOPO stops at vegetation polygons, so those still come from OSM under both providers.',
    },
    {
      title: 'Ground.',
      body: 'Terrarium is one 256-pixel tile of roughly 30 m data. IGN RGE ALTI is sampled from a ~1 m model and takes 5000 points per request, so the mesh is sized to the rectangle — about 9 m between posts across 600 m, 26 m across 1800 — instead of being pinned at 17×17. National layers arrive cut to whole forests and river systems, so every polygon is clipped to the site rectangle before it reaches the model.',
    },
  ],
} as const;

export type Dict = {
  -readonly [K in keyof typeof en]: K extends 'notes'
    ? { title: string; body: string }[]
    : string;
};
