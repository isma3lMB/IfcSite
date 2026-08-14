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
  'ui.originMarker': 'Show the model origin',
  'ui.projection': 'Orthographic view',
  /* The button is labelled with what pressing it does, not with the state it is
     in — an icon button has no room to say both, and the action is the useful
     half. */
  'ui.themeDark': 'Switch to the dark theme',
  'ui.themeLight': 'Switch to the light theme',
  'ui.dismiss': 'Dismiss',

  /* ---- tool rail. Icon-only, so every one of these is the whole label: it is
     the tooltip, the aria-label, and the only prose the tool ever gets. ---- */
  'rail.label': 'Tools',
  'rail.pan': 'Pan the map',
  'rail.select': 'Select (Esc)',
  'rail.drawBox': 'Draw a box footprint',
  'rail.drawPoly': 'Draw a polygon footprint',
  'rail.drawTree': 'Plant a tree',
  'rail.model': 'Model tree',
  'rail.file': 'Drafts',

  /* ---- drafts. The document, as against the deliverable: a draft reopens into
     this app with every edit intact, an IFC opens in everything else. The two
     verbs are deliberately not synonyms — Save keeps a site in this browser,
     Export writes a file you can move. ---- */
  'file.title': 'Drafts',
  'file.name': 'Name',
  'file.namePlaceholder': 'Site name…',
  'file.save': 'Save',
  'file.saveHint': 'Kept in this browser only. Export a draft to move it elsewhere.',
  'file.needScene': 'Build a site before saving it.',
  'file.slots': 'Saved in this browser',
  'file.noSlots': 'Nothing saved yet.',
  'file.slotMeta': '{buildings} buildings · {size} · {when}',
  'file.open': 'Open',
  'file.rename': 'Rename',
  'file.delete': 'Delete',
  'file.openFile': 'Open a draft file…',
  'file.dropHint': 'or drop a .ifcsite.json file here',
  'file.exportDraft': 'Export draft',
  'file.exportHint':
    'A portable .ifcsite.json that reopens here with every edit intact. Not a deliverable — Download is.',
  'file.unavailable': 'This browser will not store drafts. Export a draft file instead.',
  'file.renamePrompt': 'New name',

  /* ---- status bar: the one place anything is stated ---- */
  'bar.site': 'Site',
  'bar.origin': 'Origin',
  'bar.rebuild': 'Rebuild sheet',
  'bar.stale': 'Site moved since the last build — rebuild before exporting.',
  'bar.drawHeight': 'H (m)',
  'bar.newHeightTitle': 'Height of the next drawn building (m)',
  'bar.newTreeHeightTitle': 'Height of the next planted tree (m)',
  'bar.drawHintRect': 'Drag on the ground to box out a footprint. Esc cancels.',
  'bar.drawHintPoly':
    'Click each corner on the ground — no crossing edges. Enter or the first corner closes it, Esc cancels.',
  'bar.drawHintPoints': '{n} corners — Enter closes, Esc cancels.',
  'bar.drawHintTree': 'Click on the ground to plant a tree. Esc cancels.',

  /* ---- controls ---- */
  'ctl.findPlace': 'Find a place',
  'ctl.findPlacePlaceholder': 'Street, town, postcode…',
  'ctl.drawSite': 'Draw site',
  'ctl.zoomSite': 'Zoom to site',
  'ctl.crs': 'Projected CRS',
  'ctl.crsAuto': 'Auto UTM / WGS84',
  'ctl.crsNeedsSite': 'Draw a site first — the list depends on where it is.',
  'ctl.crsSearch': 'EPSG code or name…',
  'ctl.crsLoading': 'Loading the CRS index…',
  'ctl.crsError': 'CRS index unavailable — automatic UTM still works.',
  'ctl.crsNone': 'No match.',
  'ctl.crsValidHere': '{n} valid at this site',
  'ctl.defaultHeight': 'Height when untagged',
  'ctl.dataSource': 'Data source',
  'ctl.sourceOsm': 'OpenStreetMap + Terrarium — worldwide',
  'ctl.sourceIgn': 'IGN Géoplateforme — France',
  'ctl.include': 'Include',
  'ctl.buildings': 'Building footprints',
  'ctl.roads': 'Road surfaces',
  'ctl.railways': 'Railway tracks',
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

  /* ---- advanced: the collapsed group at the foot of the options flyout. Every
     one of these was a constant in the pipeline's source until the panel could
     reach it, and every default reproduces the old behaviour exactly. ---- */
  'ctl.advanced': 'Advanced',
  'ctl.advancedHint':
    'Pipeline limits. The defaults suit almost every site; changing one changes what the next build fetches.',
  'ctl.advShow': 'Show advanced settings',
  'ctl.advHide': 'Hide advanced settings',
  'ctl.advReset': 'Reset to defaults',
  'ctl.advFetch': 'Fetch limits',
  'ctl.advBuildingCap': 'Building cap',
  'ctl.advBuildingCapHint':
    'Footprints past this are dropped, not merged. Beyond a few thousand the browser, not the service, is the limit.',
  'ctl.advTreeCap': 'Tree cap',
  'ctl.advSiteMax': 'Maximum site side',
  'ctl.advSiteMaxHint':
    'Applies to the next rectangle you draw. Overpass and the IGN WFS start refusing past 2000 m.',
  'ctl.advTimeout': 'Overpass timeout',
  'ctl.advTimeoutHint':
    'Per mirror, across three. The server-side budget follows five seconds under it.',
  'ctl.advTerrainSec': 'Terrain',
  'ctl.advGridMax': 'Grid ceiling',
  'ctl.advGridCells': '{n}×{n}',
  'ctl.advGridMaxHint':
    'The densest lattice any provider may build. Every vertex is another point in the exported file.',
  'ctl.advConformStep': 'Drape step',
  'ctl.advConformStepHint':
    'How closely roads and surfaces follow the ground between terrain posts. Finer is truer and heavier.',
  'ctl.advGeometry': 'Geometry defaults',
  'ctl.advStoreyHeight': 'Storey height',
  'ctl.advStoreyHeightHint':
    'Used when a building states its number of levels but not its height.',
  'ctl.advLaneWidth': 'Lane width',
  'ctl.advTrackWidth': 'Rail track width',

  'ctl.build': 'Build sheet',
  'ctl.building': 'Building…',
  'ctl.download': 'Download IFC',

  /* ---- sheet ---- */
  'sheet.tabMap': '2D map',
  'sheet.tab3d': '3D preview',

  /* ---- readout. What the build produced, in the status bar. Road faces, tree
     and layer counts are gone: the only signal they carried — a layer came back
     empty — is already the closing clause of the build summary. ---- */
  'read.buildings': 'Buildings',
  'read.entities': 'Entities',
  'read.file': 'File',
  'unit.kb': 'kB',
  'unit.mb': 'MB',
  /* French typography puts a space before the percent sign; English does not. */
  'unit.percent': '{v}%',

  /* ---- element editor ---- */
  'ed.selected': 'Selected element',
  /* The gizmo modes are rail tooltips now, and a tooltip is where a keyboard
     shortcut belongs — it is the only surface that has room for it. */
  'ed.move': 'Move (G)',
  'ed.rotate': 'Rotate (R)',
  'ed.scale': 'Scale (S)',
  'ed.colour': 'Colour',
  'ed.defaultColour': 'Default colour',
  'ed.opacity': 'Opacity',
  'ed.solid': 'Solid',
  'ed.height': 'Height (m)',
  'ed.delete': 'Delete',
  'ed.deleteTitle': 'Delete (Del)',
  'ed.drawnName': 'Drawn building',
  'ed.drawnTreeName': 'Drawn tree',
  'ed.position': 'Position offset (m)',
  'ed.rotation': 'Rotation (°)',
  'ed.scaleLabel': 'Scale',
  'ed.lockProportions': 'Lock proportions',
  'ed.resetElement': 'Reset element',
  'ed.undo': 'Undo (Ctrl+Z)',
  'ed.redo': 'Redo (Ctrl+Shift+Z)',
  'ed.close': 'Deselect (Esc)',
  'ed.originName': 'Model origin',
  'ed.originPosition': 'Offset from site centre (m)',
  'ed.resetOrigin': 'Recentre origin',
  'ed.originHint':
    'The point the exported IFC calls (0, 0, 0). Moving it re-bases the file without moving anything on the ground.',
  'ed.projectPlacement': 'Local project placement',
  'ed.projectCoords': 'Coordinates of this point (m)',
  'ed.projectAngle': 'Angle — °counter-clockwise from grid east',
  'ed.resetPlacement': 'Reset placement',
  'ed.projectHint':
    'Give the origin point your project’s own coordinates and turn the axes to its grid. This becomes the IFC site placement; the georeferencing is unchanged. Typed, not dragged — these fields are outside the undo history.',
  'ed.layer': 'Selected layer',
  'ed.layerStyleHint':
    'Applies to every element in the layer at once, in the preview and in the exported file, where it becomes the IFC surface style. An element you restyle on its own afterwards keeps its own colour.',
  'ed.layerPosition': 'Layer offset (m)',
  'ed.layerMoveHint':
    'Moves the whole layer, and the exported IFC carries the same offset. Roads, tracks and draped surfaces were cut onto the terrain, so an offset — a vertical one above all — lifts them off the ground or sinks them into it.',

  /* ---- model tree ---- */
  'tree.title': 'Model tree',
  'tree.empty': 'Build a sheet to see its layers.',
  'tree.filter': 'Filter elements…',
  'tree.noMatch': 'Nothing matches.',
  'tree.expand': 'Expand {layer}',
  'tree.collapse': 'Collapse {layer}',
  'tree.hide': 'Hide {layer}',
  'tree.show': 'Show {layer}',
  'tree.colourOf': 'Colour of {layer}',
  'tree.merged': 'One merged element — recolour or move it from the layer above.',

  /* ---- status ---- */
  /* The full instruction is status.drawPrompt, which fires the moment the map
     arms — which is on load. This one only has to say the app is up. */
  'status.ready': 'Ready — draw a site rectangle on the map.',
  'status.queryingOverpass': 'Querying Overpass…',
  'status.queryingTrees': 'Querying OSM trees…',
  'status.fetchingIgnBuildings': 'Fetching IGN BD TOPO buildings…',
  'status.fetchingIgnRoads': 'Fetching IGN BD TOPO roads…',
  'status.fetchingIgnRailways': 'Fetching IGN BD TOPO railways…',
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
  'status.drawTooSmall': 'Too small — a footprint needs at least 1 m².',
  'status.drawFull': 'Building limit reached ({cap}) — delete something first.',
  'status.editCommitted': '{label} — {name}. Ctrl+Z to undo.',
  'status.undone': 'Undone: {label} — {name}.',
  'status.redone': 'Redone: {label} — {name}.',
  'status.searchUnavailable': 'Place search unavailable ({detail}) — pan the map instead.',
  'status.draftSaved': 'Saved “{name}”.',
  'status.draftOpening': 'Opening “{name}”…',
  'status.draftOpened': 'Opened “{name}” — {buildings} buildings.',
  'status.draftExported': 'Draft written to {file}.',
  'status.draftDeleted': 'Deleted “{name}”.',

  /* ---- build summary, composed from BuildSummary ---- */
  'sum.built':
    'Built {buildings} buildings from {provider} — {tagged} with {kind} heights, {estimated} estimated at {fallback} m.',
  'sum.kindSurveyed': 'surveyed',
  'sum.kindTagged': 'tagged',
  'sum.capped': 'Capped at {cap}; draw a smaller rectangle to see the rest.',
  'sum.treesCapped': 'Trees capped at {cap}.',
  'sum.skipped': 'No {layers} returned.',

  /* ---- layer names (UI only; the IFC keeps stable English names) ---- */
  'layer.terrain': 'terrain',
  'layer.buildings': 'buildings',
  'layer.roads': 'roads',
  'layer.railways': 'railways',
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
  'edit.opacity': 'Opacity',
  'edit.height': 'Height',
  'edit.add': 'New building',
  'edit.delete': 'Delete',
  'edit.reset': 'Reset element',
  'edit.origin': 'Move origin',
  'edit.originReset': 'Origin recentred',

  /* ---- confirmations ----
     Singular and plural are separate entries rather than an "(s)": this card
     exists to be read carefully, and one drawn building is the common case. */
  'confirm.discardTitle': 'Discard drawn elements?',
  'confirm.discardTitleOne': 'Discard the drawn element?',
  'confirm.discardDrawn':
    'Rebuilding re-fetches the site from its sources, and {n} hand-drawn buildings and trees are not in them. They will be lost — this is the one edit Ctrl+Z cannot bring back.',
  'confirm.discardDrawnOne':
    'Rebuilding re-fetches the site from its sources, and your hand-drawn element is not in them. It will be lost — this is the one edit Ctrl+Z cannot bring back.',
  'confirm.rebuildAnyway': 'Rebuild anyway',
  'confirm.keep': 'Keep editing',
  /* Opening a draft replaces the scene wholesale, so it destroys hand-drawn work
     exactly as a rebuild does — same warning, same singular/plural split. */
  'confirm.openTitle': 'Discard drawn elements?',
  'confirm.openTitleOne': 'Discard the drawn element?',
  'confirm.openOverDrawn':
    'Opening a draft replaces everything on screen, and {n} hand-drawn buildings and trees are not in it. They will be lost — this is the one edit Ctrl+Z cannot bring back.',
  'confirm.openOverDrawnOne':
    'Opening a draft replaces everything on screen, and your hand-drawn element is not in it. It will be lost — this is the one edit Ctrl+Z cannot bring back.',
  'confirm.openAnyway': 'Open anyway',
  'confirm.overwriteTitle': 'Replace “{name}”?',
  'confirm.overwriteSlot':
    'A draft of that name is already saved in this browser. Saving over it cannot be undone.',
  'confirm.overwriteAnyway': 'Replace it',
  'confirm.deleteSlotTitle': 'Delete “{name}”?',
  'confirm.deleteSlot':
    'This removes the draft from this browser for good. Any .ifcsite.json you exported is unaffected.',
  'confirm.deleteAnyway': 'Delete it',
  'confirm.cancel': 'Cancel',

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
  'err.crsUnknown': '{epsg} is not in the CRS index.',
  'err.crsIndexUnavailable':
    'The CRS index could not be loaded. Pick the automatic UTM zone, or reload the page.',
  'err.draftUnreadable': 'That is not an IFC Site draft file.',
  'err.draftVersion':
    'This draft was written by a newer version of IFC Site (format {version}). Update the page and try again.',
  'err.draftCorrupt': 'The draft is incomplete and cannot be opened.',
  'err.slotsUnavailable':
    'This browser will not store drafts — private browsing, most likely. Export a draft file instead.',

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
      body: 'The rectangle you place on the OpenStreetMap basemap — two corner clicks, or one drag — is the whole site definition. Nothing is selected until you draw it: its bounds go to Overpass and the IGN WFS as a bbox, size the terrain grid, and clip every polygon that crosses the edge. It is a WGS84 rectangle, so in a projected CRS it is very slightly rotated by grid convergence; the local clip box is taken from the outermost corner so nothing you drew is cropped. Sides are held between 100 m and 2000 m by default — past that Overpass and the WFS start refusing, and Advanced is where you decide how close to that you want to sail. Basemap tiles and the place search come from OpenStreetMap and Nominatim; both are free services, so keep the requests light.',
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
