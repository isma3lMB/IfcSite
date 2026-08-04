import type { Dict } from '@/lib/i18n/en';

/**
 * French — the default language, and the one the page boots into.
 *
 * Register follows the original: terse and technical, addressing someone who
 * already knows what a CRS and a swept solid are. GIS terms use the vocabulary
 * QGIS and the IGN use in French ("SCR", "emprise", "BD TOPO"), and IFC entity
 * names are left untranslated because they are schema identifiers.
 */
export const fr: Dict = {
  /* ---- chrome ---- */
  'app.title': 'IFC Site — contexte de site vers IFC',
  'app.description':
    'Tracez un rectangle sur une carte et obtenez un fichier IFC4 géoréférencé des bâtiments, voiries et terrain qu’il contient — entièrement dans le navigateur.',
  'app.wordmark': 'IFC Site',
  'app.tag': 'Sans serveur · s’exécute dans cet onglet',
  'app.h1a': 'IFC',
  'app.h1b': 'Site',
  'app.sub':
    'Tracez un rectangle sur la carte. Il récupère les bâtiments et les voiries qu’il contient, les extrude et écrit un fichier IFC4 géoréférencé — entièrement dans le navigateur.',
  'app.badge': 'Volumétrie LOD1\nIfcBuildingElementProxy\nLoGeoRef 50',
  'app.langLabel': 'Langue',

  /* ---- habillage ---- */
  'ui.info': 'À propos de cet outil',
  'ui.close': 'Fermer',
  'ui.options': 'Options',
  'ui.collapse': 'Masquer les options',
  'ui.expand': 'Afficher les options',
  'ui.originMarker': 'Afficher l’origine du modèle',

  /* ---- barre de progression : une étape, une action ---- */
  'flow.stepDraw': 'Tracer',
  'flow.stepBuild': 'Construire',
  'flow.stepExport': 'Exporter',
  'flow.mode': 'Mode carte',
  'flow.draw': 'Tracer',
  'flow.pan': 'Déplacer',
  'flow.redraw': 'Retracer',
  'flow.rebuild': 'Reconstruire',
  'flow.stale': 'Site déplacé depuis la dernière construction — reconstruisez avant d’exporter.',

  /* ---- controls ---- */
  'ctl.findPlace': 'Rechercher un lieu',
  'ctl.findPlacePlaceholder': 'Rue, ville, code postal…',
  'ctl.siteExtent': 'Emprise du site',
  'ctl.rectangle': 'Rectangle',
  'ctl.drawOnMap': 'tracez-en un sur la carte',
  'ctl.siteHint':
    'Cliquez deux coins opposés sur la carte — ou glissez pour le balayer d’un seul geste. Glissez les coins pour le redimensionner, le rectangle lui-même pour le déplacer.',
  'ctl.drawSite': 'Tracer le site',
  'ctl.zoomSite': 'Zoomer sur le site',
  'ctl.crs': 'SCR projeté',
  'ctl.crsAuto': 'UTM / WGS84 automatique',
  'ctl.defaultHeight': 'Hauteur si non renseignée',
  'ctl.dataSource': 'Source de données',
  'ctl.sourceOsm': 'OpenStreetMap + Terrarium — monde entier',
  'ctl.sourceIgn': 'IGN Géoplateforme — France',
  'ctl.include': 'Inclure',
  'ctl.roads': 'Surfaces de voirie',
  'ctl.terrain': 'Maillage du terrain',
  'ctl.terrainSrcOsm': 'Terrarium ~30 m',
  'ctl.terrainSrcIgn': 'RGE ALTI ~1 m',
  'ctl.trees': 'Arbres isolés',
  'ctl.accuracy': 'Précision du terrain',
  'ctl.accuracyCoarse': 'Grossière — mailles de 30 m',
  'ctl.accuracyStandard': 'Standard — mailles de 15 m',
  'ctl.accuracyFine': 'Fine — mailles de 5 m',
  'ctl.accuracyMax': 'Maximale — mailles de 1 m',
  'ctl.accuracyCell': '{n}×{n} · ~{m} m',
  'ctl.accuracyHint':
    'Un échantillonnage plus dense est plus long à récupérer et plus lourd à exporter.',
  'ctl.veg': 'Végétation et haies',
  'ctl.water': 'Surfaces en eau',
  'ctl.parcels': 'Parcelles cadastrales',
  'ctl.build': 'Construire la maquette',
  'ctl.building': 'Construction…',
  'ctl.download': 'Télécharger l’IFC',

  /* ---- sheet ---- */
  'sheet.tabMap': 'Carte 2D',
  'sheet.tab3d': 'Aperçu 3D',
  'sheet.origin': 'origine —',
  'sheet.hudLegend': 'jaune = hauteur renseignée · gris = estimée',
  'sheet.hudHint':
    'cliquez un bâtiment pour l’éditer · glissez pour orbiter · molette pour zoomer · Maj+glisser pour déplacer',

  /* ---- readout ---- */
  'read.buildings': 'Bâtiments',
  'read.tagged': 'Hauteur renseignée',
  'read.roadFaces': 'Faces de voirie',
  'read.trees': 'Arbres',
  'read.layers': 'Couches',
  'read.entities': 'Entités',
  'read.file': 'Fichier',
  'unit.kb': 'ko',
  'unit.mb': 'Mo',
  'unit.percent': '{v} %',

  /* ---- element editor ---- */
  'ed.selected': 'Élément sélectionné',
  'ed.empty': 'Cliquez un bâtiment dans l’aperçu 3D pour l’éditer.',
  'ed.gizmo': 'Manipulateur',
  'ed.move': 'Déplacer',
  'ed.rotate': 'Pivoter',
  'ed.scale': 'Redimensionner',
  'ed.colour': 'Couleur',
  'ed.defaultColour': 'Couleur par défaut',
  'ed.position': 'Décalage de position (m)',
  'ed.rotation': 'Rotation (°)',
  'ed.scaleLabel': 'Échelle',
  'ed.lockProportions': 'Conserver les proportions',
  'ed.resetElement': 'Réinitialiser l’élément',
  'ed.deselect': 'Désélectionner',
  'ed.undo': 'Annuler (Ctrl+Z)',
  'ed.redo': 'Rétablir (Ctrl+Maj+Z)',
  'ed.close': 'Désélectionner (Échap)',
  'ed.hint':
    'W / E / R changent de manipulateur · Échap désélectionne · Ctrl+Z et Ctrl+Maj+Z parcourent l’historique. Les modifications sont écrites dans l’IFC téléchargé.',
  'ed.originName': 'Origine du modèle',
  'ed.originPosition': 'Décalage depuis le centre du site (m)',
  'ed.resetOrigin': 'Recentrer l’origine',
  'ed.originHint':
    'C’est le point que l’IFC exporté utilise comme (0, 0, 0). Le déplacer rebase le fichier sans rien déplacer au sol — le géoréférencement suit.',
  'ed.projectPlacement': 'Calage local du projet',
  'ed.projectCoords': 'Coordonnées de ce point (m)',
  'ed.projectAngle': 'Angle — ° antihoraire depuis l’est du quadrillage',
  'ed.resetPlacement': 'Réinitialiser le calage',
  'ed.projectHint':
    'Donnez au point d’origine les coordonnées dans lesquelles votre projet travaille, et orientez les axes sur son quadrillage. Cela devient le calage du site dans l’IFC ; le géoréférencement est inchangé, donc tout reste au même endroit sur la carte. Saisis ici, non glissés — ces deux champs sont hors de l’historique.',

  /* ---- status ---- */
  'status.ready': 'Prêt. Cliquez deux coins opposés sur la carte pour définir le site.',
  'status.queryingOverpass': 'Interrogation d’Overpass…',
  'status.queryingTrees': 'Interrogation des arbres OSM…',
  'status.fetchingIgnBuildings': 'Récupération des bâtiments IGN BD TOPO…',
  'status.fetchingIgnRoads': 'Récupération des voiries IGN BD TOPO…',
  'status.fetchingIgnLayer': 'Récupération des données IGN : {layer}…',
  'status.samplingAlti': 'Échantillonnage du RGE ALTI de l’IGN…',
  'status.samplingAltiChunk': 'Échantillonnage du RGE ALTI de l’IGN — lot {done} sur {total}…',
  'status.readingTerrainTile': 'Lecture des tuiles d’altitude…',
  'status.terrainUnavailable':
    'Terrain indisponible ({detail}) — poursuite sur un plan horizontal.',
  'status.datumUnavailable':
    'Altitude du site indisponible ({detail}) — poursuite à zéro, sans altitudes.',
  'status.siteClamped': 'Site limité à {min}–{max} m de côté.',
  'status.siteSet': 'Site de {w} × {h} m — construisez la maquette.',
  'status.drawPrompt':
    'Cliquez deux coins opposés pour définir le site. Échap passe en déplacement.',
  'status.drawModeOff': 'Mode déplacement — glissez pour déplacer la carte.',
  'status.drawCancelled': 'Tracé annulé.',
  'status.cornerSet': 'Premier coin posé — cliquez le coin opposé. Échap annule.',
  'status.noSiteYet': 'Aucun site — cliquez deux coins opposés sur la carte.',
  'status.editCommitted': '{label} — {name}. Ctrl+Z pour annuler.',
  'status.undone': 'Annulé : {label} — {name}.',
  'status.redone': 'Rétabli : {label} — {name}.',
  'status.searchUnavailable':
    'Recherche de lieu indisponible ({detail}) — déplacez la carte à la place.',

  /* ---- build summary ---- */
  'sum.built':
    '{buildings} bâtiments construits depuis {provider} — {tagged} avec une hauteur {kind}, {estimated} estimés à {fallback} m.',
  'sum.kindSurveyed': 'relevée',
  'sum.kindTagged': 'renseignée',
  'sum.capped': 'Limité à {cap} ; tracez un rectangle plus petit pour voir le reste.',
  'sum.treesCapped': 'Arbres limités à {cap}.',
  'sum.skipped': 'Aucune donnée renvoyée : {layers}.',

  /* ---- layer names ---- */
  'layer.vegetation': 'végétation',
  'layer.hedges': 'haies',
  'layer.water': 'surfaces en eau',
  'layer.parcels': 'parcelles',
  'layer.trees': 'arbres',

  /* ---- undo-stack command names ---- */
  'edit.move': 'Déplacement',
  'edit.rotate': 'Rotation',
  'edit.scale': 'Redimensionnement',
  'edit.colour': 'Couleur',
  'edit.colourReset': 'Couleur réinitialisée',
  'edit.reset': 'Élément réinitialisé',
  'edit.origin': 'Déplacement de l’origine',
  'edit.originReset': 'Origine recentrée',

  /* ---- errors ---- */
  'err.overpassAllRefused': 'Tous les miroirs Overpass ont refusé la requête.',
  'err.overpassTimeout': '{host} n’a pas répondu à temps',
  'err.overpassStatus': '{host} a renvoyé {status}',
  'err.ignWfsStatus': 'IGN {layer} a renvoyé {status}',
  'err.altiStatus': 'RGE ALTI a renvoyé {status}',
  'err.altiShortGrid': 'RGE ALTI a renvoyé une grille incomplète',
  'err.altiOutsideCoverage': 'hors de l’emprise RGE ALTI',
  'err.altiGridTooLarge': 'grille d’altitude trop grande',
  'err.terrainTileBlocked': 'tuile de terrain bloquée',
  'err.nominatimStatus': 'Nominatim a renvoyé {status}',
  'err.ignOutsideFrance':
    'L’IGN ne couvre que la France métropolitaine, et ce rectangle en sort. Passez la source de données sur OpenStreetMap, ou déplacez le site.',
  'err.noBuildingsIgn':
    'L’IGN n’a renvoyé aucun bâtiment ici. Hors de France, passez la source de données sur OpenStreetMap ; en France, tracez un rectangle plus grand.',
  'err.noBuildingsOsm':
    'Aucun bâtiment cartographié dans ce rectangle. Tracez-en un plus grand, ou choisissez un secteur plus dense.',
  'err.noSite': 'Tracez d’abord un rectangle de site sur la carte.',

  /* ---- notes ---- */
  notes: [
    {
      title: 'Où tout s’exécute.',
      body: 'Tout est côté client. Overpass envoie `Access-Control-Allow-Origin: *`, le navigateur peut donc l’interroger directement, et l’IFC est sérialisé en JavaScript puis remis à une URL Blob. Aucun serveur ne touche vos données.',
    },
    {
      title: 'Sens de parcours.',
      body: 'Les emprises OSM arrivent dans les deux sens. Les profils IFC exigent des contours extérieurs dans le sens trigonométrique : chaque anneau est donc vérifié par son aire signée et inversé si besoin — sans cela, près de la moitié des bâtiments s’affichent retournés ou disparaissent.',
    },
    {
      title: 'Géoréférencement.',
      body: 'Écrit sous forme d’`IfcMapConversion` + `IfcProjectedCRS`. `Scale` vaut 1.0, ce qui convient à cette emprise ; au-delà de quelques kilomètres, substituez le facteur d’échelle combiné réel, sinon votre maquette divergera de celle du géomètre.',
    },
    {
      title: 'Tracer le site.',
      body: 'Le rectangle que vous posez sur le fond OpenStreetMap — deux clics de coin, ou un glisser — constitue toute la définition du site. Rien n’est sélectionné tant que vous ne l’avez pas tracé : ses limites partent vers Overpass et le WFS de l’IGN comme bbox, dimensionnent la grille de terrain et découpent tout polygone qui franchit le bord. C’est un rectangle WGS84 : dans un SCR projeté il est donc très légèrement pivoté par la convergence des méridiens ; la boîte de découpe locale est prise sur le coin le plus extérieur, afin que rien de ce que vous avez tracé ne soit rogné. Les côtés sont maintenus entre 100 m et 2000 m — au-delà, Overpass et le WFS commencent à refuser. Les tuiles du fond de plan et la recherche de lieu proviennent d’OpenStreetMap et de Nominatim ; ce sont des services gratuits, gardez donc les requêtes légères.',
    },
    {
      title: 'Deux fournisseurs.',
      body: 'OpenStreetMap fonctionne partout mais devine la hauteur à partir de `building:levels × 3`, puis d’une constante. En France, l’IGN Géoplateforme sert la BD TOPO avec une `hauteur` relevée sur presque chaque bâtiment, plus la végétation, l’hydrographie et les parcelles cadastrales — et `data.geopf.fr` envoie `Access-Control-Allow-Origin: *` sans clé d’API, ce qui reste aussi dépourvu de serveur qu’Overpass. Les arbres isolés font exception : la BD TOPO s’arrête aux polygones de végétation, ils viennent donc toujours d’OSM quel que soit le fournisseur.',
    },
    {
      title: 'Le sol.',
      body: 'Terrarium, c’est une tuile de 256 pixels à environ 30 m de résolution. Le RGE ALTI de l’IGN est échantillonné sur un modèle à ~1 m et accepte 5000 points par requête : le maillage est donc dimensionné sur le rectangle — environ 9 m entre les points sur 600 m, 26 m sur 1800 — au lieu d’être figé à 17×17. Les couches nationales arrivent découpées à l’échelle de forêts et de réseaux hydrographiques entiers ; chaque polygone est donc découpé sur le rectangle du site avant d’atteindre la maquette.',
    },
  ],
};
