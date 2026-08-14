/**
 * The vocabulary the pure logic speaks.
 *
 * Nothing under lib/sources, lib/geo, lib/build or lib/viewer may build a
 * user-facing sentence: they emit one of these keys plus a params bag, and the
 * React layer looks it up in the active dictionary. That is what lets the
 * language toggle re-render an already-displayed status line.
 */

/** Progress and outcome messages, emitted through an `onStatus` callback. */
export type StatusKey =
  | 'status.ready'
  | 'status.queryingOverpass'
  | 'status.queryingTrees'
  | 'status.fetchingIgnBuildings'
  | 'status.fetchingIgnRoads'
  | 'status.fetchingIgnRailways'
  | 'status.fetchingIgnLayer'
  | 'status.samplingAlti'
  | 'status.samplingAltiChunk'
  | 'status.readingTerrainTile'
  | 'status.terrainUnavailable'
  | 'status.datumUnavailable'
  | 'status.siteClamped'
  | 'status.siteSet'
  | 'status.drawPrompt'
  | 'status.drawModeOff'
  | 'status.drawCancelled'
  | 'status.cornerSet'
  | 'status.noSiteYet'
  | 'status.drawTooSmall'
  | 'status.drawFull'
  | 'status.editCommitted'
  | 'status.undone'
  | 'status.redone'
  | 'status.searchUnavailable';

/**
 * Failures. Every `throw` in the data layer carries one of these instead of an
 * English message, so the status line can be translated. Anything that escapes
 * without a code still surfaces via `e.message` rather than vanishing.
 */
export type ErrorCode =
  | 'err.overpassAllRefused'
  | 'err.overpassTimeout'
  | 'err.overpassStatus'
  | 'err.ignWfsStatus'
  | 'err.altiStatus'
  | 'err.altiShortGrid'
  | 'err.altiOutsideCoverage'
  | 'err.altiGridTooLarge'
  | 'err.terrainTileBlocked'
  | 'err.nominatimStatus'
  | 'err.ignOutsideFrance'
  | 'err.noBuildingsIgn'
  | 'err.noBuildingsOsm'
  | 'err.noSite'
  | 'err.crsUnknown'
  | 'err.crsIndexUnavailable';

/**
 * Layer names. These appear in progress lines ("Fetching IGN vegetation…"), in
 * the "no X returned" tail of the build summary, and as the model tree's own
 * row labels, so they have to be a key rather than the English label the
 * original hung off IGN_LAYERS[*].label.
 *
 * Lowercase noun phrases, because two of those three uses are mid-sentence. The
 * tree capitalises its own first letter in CSS rather than holding a second set
 * of title-case strings that would have to be kept in step.
 */
export type LayerKey =
  | 'layer.terrain'
  | 'layer.buildings'
  | 'layer.roads'
  | 'layer.railways'
  | 'layer.vegetation'
  | 'layer.hedges'
  | 'layer.water'
  | 'layer.parcels'
  | 'layer.trees';

/** Undo-stack command names, so "Undone: Move — Building 12" translates. */
export type EditLabelKey =
  | 'edit.move'
  | 'edit.rotate'
  | 'edit.scale'
  | 'edit.colour'
  | 'edit.colourReset'
  | 'edit.opacity'
  | 'edit.height'
  | 'edit.add'
  | 'edit.delete'
  | 'edit.reset'
  | 'edit.origin'
  | 'edit.originReset';

/**
 * Substituted into `{placeholders}` by the `t()` helper.
 *
 * A param whose value is itself a dictionary key is translated before being
 * substituted, which is what lets one status key nest another — `status.undone`
 * takes an `edit.*` label, `status.fetchingIgnLayer` takes a `layer.*` name, and
 * `status.terrainUnavailable` takes the `err.*` code that caused it.
 */
export type Params = Record<string, string | number>;
