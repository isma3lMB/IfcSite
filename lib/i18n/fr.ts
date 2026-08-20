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
    'Tracez un rectangle sur une carte et obtenez un fichier IFC géoréférencé des bâtiments, voiries et terrain qu’il contient — entièrement dans le navigateur.',
  'app.wordmark': 'IFC Site',
  'app.tag': 'Sans serveur · s’exécute dans cet onglet',
  'app.h1a': 'IFC',
  'app.h1b': 'Site',
  'app.sub':
    'Tracez un rectangle sur la carte. Il récupère les bâtiments et les voiries qu’il contient, les extrude et écrit un fichier IFC géoréférencé — entièrement dans le navigateur.',
  'app.badge': 'Volumétrie LOD1\nIfcBuildingElementProxy\nLoGeoRef 50',
  'app.langLabel': 'Langue',

  /* ---- habillage ---- */
  'ui.info': 'À propos de cet outil',
  'ui.close': 'Fermer',
  'ui.options': 'Options',
  'ui.originMarker': 'Afficher l’origine du modèle',
  'ui.projection': 'Vue orthographique',
  'ui.themeDark': 'Passer au thème sombre',
  'ui.themeLight': 'Passer au thème clair',
  'ui.dismiss': 'Masquer',

  /* ---- barre d’outils : uniquement des icônes, donc chacun de ces libellés
     est tout ce que l’outil obtient — infobulle et aria-label à la fois. ---- */
  'rail.label': 'Outils',
  'rail.pan': 'Déplacer la carte',
  'rail.select': 'Sélectionner (Échap)',
  'rail.drawBox': 'Tracer une emprise rectangulaire',
  'rail.drawPoly': 'Tracer une emprise polygonale',
  'rail.drawTree': 'Planter un arbre',
  'rail.measure': 'Mesurer une distance',
  'rail.measureArea': 'Mesurer une surface',
  'rail.model': 'Arborescence du modèle',
  'rail.file': 'Ébauches',

  /* ---- ébauches. Le document, par opposition au livrable : une ébauche se
     rouvre dans cette application avec toutes ses modifications, un IFC s’ouvre
     partout ailleurs. Les deux verbes ne sont pas synonymes — Enregistrer garde
     le site dans ce navigateur, Exporter écrit un fichier déplaçable. ---- */
  'file.title': 'Ébauches',
  'file.name': 'Nom',
  'file.namePlaceholder': 'Nom du site…',
  'file.save': 'Enregistrer',
  'file.saveHint':
    'Conservé dans ce navigateur uniquement. Exportez une ébauche pour l’emporter ailleurs.',
  'file.needScene': 'Construisez un site avant de l’enregistrer.',
  'file.slots': 'Enregistrés dans ce navigateur',
  'file.noSlots': 'Rien d’enregistré pour l’instant.',
  'file.slotMeta': '{buildings} bâtiments · {size} · {when}',
  'file.open': 'Ouvrir',
  'file.rename': 'Renommer',
  'file.delete': 'Supprimer',
  'file.openFile': 'Ouvrir un fichier d’ébauche…',
  'file.dropHint': 'ou déposez un fichier .ifcsite.json ici',
  'file.exportDraft': 'Exporter l’ébauche',
  'file.exportHint':
    'Un fichier .ifcsite.json transportable qui se rouvre ici avec toutes vos modifications. Ce n’est pas un livrable — Télécharger l’est.',
  'file.unavailable':
    'Ce navigateur n’enregistrera pas d’ébauches. Exportez plutôt un fichier d’ébauche.',
  'file.renamePrompt': 'Nouveau nom',

  /* ---- barre d’état : le seul endroit où quelque chose est énoncé ---- */
  'bar.site': 'Site',
  'bar.origin': 'Origine',
  'bar.rebuild': 'Reconstruire',
  'bar.stale': 'Site déplacé depuis la dernière construction — reconstruisez avant d’exporter.',
  'bar.drawHeight': 'H (m)',
  'bar.newHeightTitle': 'Hauteur du prochain bâtiment tracé (m)',
  'bar.newTreeHeightTitle': 'Hauteur du prochain arbre planté (m)',
  'bar.drawHintRect': 'Glissez sur le sol pour tracer une emprise rectangulaire. Échap annule.',
  'bar.drawHintPoly':
    'Cliquez chaque sommet sur le sol — sans arêtes croisées. Entrée ou le premier sommet ferme le contour, Échap annule.',
  'bar.drawHintPoints': '{n} sommets — Entrée ferme, Échap annule.',
  'bar.drawHintTree': 'Cliquez sur le sol pour planter un arbre. Échap annule.',
  /* Les outils de mesure lisent la scène au lieu d’y ajouter : leurs libellés
     doivent dire ce qui subsiste — une mesure prise survit à Échap, seul Effacer
     la retire. */
  'bar.measureHintStart':
    'Cliquez un point — sommets et arêtes sont magnétiques. Échap quitte l’outil.',
  'bar.measureHintEnd': 'Cliquez le second point. La mesure repart de là ; Échap arrête.',
  'bar.areaHintStart':
    'Cliquez les sommets d’une surface — sommets et arêtes sont magnétiques. Échap quitte l’outil.',
  'bar.areaHintPoints': '{n} sommets — le premier sommet ou Entrée ferme, Échap annule.',
  'bar.measureClear': 'Effacer ({n})',

  /* ---- controls ---- */
  'ctl.findPlace': 'Rechercher un lieu',
  'ctl.findPlacePlaceholder': 'Rue, ville, code postal…',
  'ctl.drawSite': 'Tracer le site',
  'ctl.zoomSite': 'Zoomer sur le site',
  'ctl.crs': 'SCR projeté',
  'ctl.crsAuto': 'UTM / WGS84 automatique',
  'ctl.crsNeedsSite': 'Tracez d’abord un site — la liste dépend de son emplacement.',
  'ctl.crsSearch': 'Code EPSG ou nom…',
  'ctl.crsLoading': 'Chargement de l’index des SCR…',
  'ctl.crsError': 'Index des SCR indisponible — l’UTM automatique reste utilisable.',
  'ctl.crsNone': 'Aucun résultat.',
  'ctl.crsValidHere': '{n} valables sur ce site',
  'ctl.ifcSchema': 'Schéma IFC',
  'ctl.ifcSchema2x3': 'IFC2X3 — logiciels plus anciens',
  'ctl.ifcSchema4': 'IFC4 — par défaut',
  'ctl.ifcSchema4x3': 'IFC4X3 — infrastructure',
  'ctl.ifcSchemaBrepHint':
    'IFC2X3 ne connaît pas la tessellation : le terrain, les voiries et les arbres sont exportés en représentation par frontières — le même modèle, dans un fichier plusieurs fois plus lourd.',
  'ctl.verticalDatum': 'Référence verticale',
  'ctl.verticalDatumNone': 'Aucun — plat',
  'ctl.verticalDatumHint':
    'Les sites IGN utilisent NGF-IGN69 ; les sites OSM utilisent EGM96 dès lors que le terrain est inclus — sans lui, le modèle n’a aucune référence verticale.',
  'ctl.defaultHeight': 'Hauteur si non renseignée',
  'ctl.dataSource': 'Source de données',
  'ctl.sourceOsm': 'OpenStreetMap + Terrarium — monde entier',
  'ctl.sourceIgn': 'IGN Géoplateforme — France',
  'ctl.include': 'Inclure',
  'ctl.buildings': 'Emprises des bâtiments',
  'ctl.roads': 'Surfaces de voirie',
  'ctl.railways': 'Voies ferrées',
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

  /* ---- avancé ---- */
  'ctl.advanced': 'Avancé',
  'ctl.advancedHint':
    'Limites du pipeline. Les valeurs par défaut conviennent à presque tous les sites ; en modifier une change ce que la prochaine construction récupère.',
  'ctl.advShow': 'Afficher les réglages avancés',
  'ctl.advHide': 'Masquer les réglages avancés',
  'ctl.advReset': 'Rétablir les valeurs par défaut',
  'ctl.advFetch': 'Limites de récupération',
  'ctl.advBuildingCap': 'Plafond de bâtiments',
  'ctl.advBuildingCapHint':
    'Les emprises au-delà sont abandonnées, pas fusionnées. Passé quelques milliers, c’est le navigateur qui limite, pas le service.',
  'ctl.advTreeCap': 'Plafond d’arbres',
  'ctl.advSiteMax': 'Côté maximal du site',
  'ctl.advSiteMaxHint':
    'S’applique au prochain rectangle tracé. Overpass et le WFS IGN commencent à refuser au-delà de 2000 m.',
  'ctl.advTimeout': 'Délai d’attente Overpass',
  'ctl.advTimeoutHint':
    'Par miroir, sur trois. Le budget côté serveur suit cinq secondes en dessous.',
  'ctl.advTerrainSec': 'Terrain',
  'ctl.advGridMax': 'Plafond de la grille',
  'ctl.advGridCells': '{n}×{n}',
  'ctl.advGridMaxHint':
    'Le maillage le plus dense qu’un fournisseur puisse produire. Chaque sommet est un point de plus dans le fichier exporté.',
  'ctl.advConformStep': 'Pas de drapage',
  'ctl.advConformStepHint':
    'À quel point la voirie et les surfaces suivent le sol entre les points du terrain. Plus fin, plus juste, plus lourd.',
  'ctl.advGeometry': 'Valeurs géométriques par défaut',
  'ctl.advStoreyHeight': 'Hauteur d’étage',
  'ctl.advStoreyHeightHint':
    'Utilisée lorsqu’un bâtiment indique son nombre de niveaux mais pas sa hauteur.',
  'ctl.advLaneWidth': 'Largeur d’une voie',
  'ctl.advTrackWidth': 'Largeur d’une voie ferrée',

  'ctl.build': 'Construire la maquette',
  'ctl.building': 'Construction…',
  'ctl.download': 'Télécharger l’IFC',

  /* ---- sheet ---- */
  'sheet.tabMap': 'Carte 2D',
  'sheet.tab3d': 'Aperçu 3D',

  /* ---- readout : ce que la construction a produit, dans la barre d’état ---- */
  'read.buildings': 'Bâtiments',
  'read.datum': 'Datum',
  'read.datumFlat': 'Aucun — plat',
  'read.entities': 'Entités',
  'read.file': 'Fichier',
  'unit.kb': 'ko',
  'unit.mb': 'Mo',
  'unit.percent': '{v} %',

  /* ---- element editor ---- */
  'ed.selected': 'Élément sélectionné',
  /* Les modes du manipulateur sont désormais des infobulles de la barre
     d’outils, et c’est là que le raccourci a sa place. */
  'ed.move': 'Déplacer (G)',
  'ed.rotate': 'Pivoter (R)',
  'ed.scale': 'Redimensionner (S)',
  'ed.colour': 'Couleur',
  'ed.defaultColour': 'Couleur par défaut',
  'ed.opacity': 'Opacité',
  'ed.solid': 'Opaque',
  'ed.height': 'Hauteur (m)',
  'ed.delete': 'Supprimer',
  'ed.deleteTitle': 'Supprimer (Suppr)',
  'ed.drawnName': 'Bâtiment tracé',
  'ed.drawnTreeName': 'Arbre planté',
  'ed.position': 'Décalage de position (m)',
  'ed.rotation': 'Rotation (°)',
  'ed.scaleLabel': 'Échelle',
  'ed.lockProportions': 'Conserver les proportions',
  'ed.resetElement': 'Réinitialiser',
  'ed.undo': 'Annuler (Ctrl+Z)',
  'ed.redo': 'Rétablir (Ctrl+Maj+Z)',
  'ed.close': 'Désélectionner (Échap)',
  'ed.originName': 'Origine du modèle',
  'ed.originPosition': 'Position globale — {epsg} (m)',
  'ed.resetOrigin': 'Recentrer l’origine',
  'ed.originHint':
    'Le point que l’IFC exporté appelle (0, 0, 0). Le déplacer rebase le fichier sans rien déplacer au sol.',
  'ed.projectPlacement': 'Calage local du projet',
  'ed.projectCoords': 'Coordonnées de ce point (m)',
  'ed.projectAngle': 'Angle — ° antihoraire depuis l’est du quadrillage',
  'ed.resetPlacement': 'Réinitialiser le calage',
  'ed.projectHint':
    'Donnez au point d’origine les coordonnées propres à votre projet et orientez les axes sur son quadrillage. Cela devient le calage du site dans l’IFC ; le géoréférencement est inchangé. Saisis, non glissés — ces champs sont hors de l’historique.',
  'ed.layer': 'Calque sélectionné',
  'ed.layerStyleHint':
    'S’applique d’un coup à tous les éléments du calque, dans l’aperçu comme dans le fichier exporté, où cela devient le style de surface IFC. Un élément restylé ensuite individuellement garde sa propre couleur.',
  'ed.layerPosition': 'Décalage du calque (m)',
  'ed.layerMoveHint':
    'Déplace le calque entier, et l’IFC exporté porte le même décalage. Voiries, voies ferrées et surfaces drapées ont été découpées sur le terrain : un décalage — vertical surtout — les décolle du sol ou les y enfonce.',

  /* ---- arborescence du modèle ---- */
  'tree.title': 'Arborescence du modèle',
  'tree.empty': 'Construisez une maquette pour voir ses calques.',
  'tree.filter': 'Filtrer les éléments…',
  'tree.noMatch': 'Aucun résultat.',
  'tree.expand': 'Déplier : {layer}',
  'tree.collapse': 'Replier : {layer}',
  'tree.hide': 'Masquer : {layer}',
  'tree.show': 'Afficher : {layer}',
  'tree.colourOf': 'Couleur : {layer}',
  'tree.merged': 'Un seul élément fusionné — recolorez-le ou déplacez-le depuis le calque ci-dessus.',

  /* ---- status ---- */
  /* L’instruction complète est status.drawPrompt, émis dès que la carte s’arme
     — c’est-à-dire au chargement. Celui-ci dit seulement que l’outil est prêt. */
  'status.ready': 'Prêt — tracez un rectangle de site sur la carte.',
  'status.resolvingCrs': 'Résolution du système de coordonnées…',
  'status.queryingOverpass': 'Interrogation d’Overpass…',
  /* Nommé, car le basculement épuise le délai complet sur chaque miroir l’un
     après l’autre : une ligne figée trois minutes se lit comme un blocage. */
  'status.overpassMirror': 'Interrogation d’Overpass — essai de {host}…',
  'status.parsingBuildings': 'Lecture des emprises de bâtiments…',
  'status.buildingRoads': 'Fusion des voiries et calage sur le terrain…',
  'status.assembling': 'Assemblage du modèle et construction de la vue 3D…',
  'status.queryingTrees': 'Interrogation des arbres OSM…',
  'status.fetchingIgnBuildings': 'Récupération des bâtiments IGN BD TOPO…',
  'status.fetchingIgnRoads': 'Récupération des voiries IGN BD TOPO…',
  'status.fetchingIgnRailways': 'Récupération des voies ferrées IGN BD TOPO…',
  'status.fetchingIgnLayer': 'Récupération des données IGN : {layer}…',
  'status.samplingAlti': 'Échantillonnage du RGE ALTI de l’IGN…',
  'status.samplingAltiChunk': 'Échantillonnage du RGE ALTI de l’IGN — lot {done} sur {total}…',
  'status.readingTerrainTile': 'Lecture des tuiles d’altitude…',
  'status.readingTerrainTiles': 'Lecture des tuiles d’altitude — {done} sur {total}…',
  'status.buildingTerrain': 'Construction du maillage du terrain…',
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
  'status.drawTooSmall': 'Trop petit — une emprise doit faire au moins 1 m².',
  'status.drawFull': 'Limite de bâtiments atteinte ({cap}) — supprimez-en un d’abord.',
  'status.measureCleared': 'Mesures effacées.',
  'status.editCommitted': '{label} — {name}. Ctrl+Z pour annuler.',
  'status.undone': 'Annulé : {label} — {name}.',
  'status.redone': 'Rétabli : {label} — {name}.',
  'status.searchUnavailable':
    'Recherche de lieu indisponible ({detail}) — déplacez la carte à la place.',
  'status.draftSaved': '« {name} » enregistré.',
  'status.draftReading': 'Lecture de « {name} »…',
  'status.draftChecking': 'Vérification de l’ébauche…',
  'status.draftOpening': 'Ouverture de « {name} »…',
  'status.draftOpened': '« {name} » ouvert — {buildings} bâtiments.',
  'status.draftExported': 'Ébauche écrite dans {file}.',
  'status.draftDeleted': '« {name} » supprimé.',

  /* ---- build summary ---- */
  'sum.built':
    '{buildings} bâtiments construits depuis {provider} — {tagged} avec une hauteur {kind}, {estimated} estimés à {fallback} m.',
  'sum.kindSurveyed': 'relevée',
  'sum.kindTagged': 'renseignée',
  'sum.capped': 'Limité à {cap} ; tracez un rectangle plus petit pour voir le reste.',
  'sum.treesCapped': 'Arbres limités à {cap}.',
  'sum.skipped': 'Aucune donnée renvoyée : {layers}.',

  /* ---- layer names ---- */
  'layer.terrain': 'terrain',
  'layer.buildings': 'bâtiments',
  'layer.roads': 'voiries',
  'layer.railways': 'voies ferrées',
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
  'edit.opacity': 'Opacité',
  'edit.height': 'Hauteur',
  'edit.add': 'Nouveau bâtiment',
  'edit.delete': 'Suppression',
  'edit.reset': 'Élément réinitialisé',
  'edit.origin': 'Déplacement de l’origine',
  'edit.originReset': 'Origine recentrée',

  /* ---- confirmations ---- */
  'confirm.discardTitle': 'Supprimer les éléments tracés ?',
  'confirm.discardTitleOne': 'Supprimer l’élément tracé ?',
  'confirm.discardDrawn':
    'Reconstruire recharge le site depuis ses sources, où vos {n} bâtiments et arbres tracés à la main ne figurent pas. Ils seront perdus — c’est la seule modification que Ctrl+Z ne peut pas rétablir.',
  'confirm.discardDrawnOne':
    'Reconstruire recharge le site depuis ses sources, où votre élément tracé à la main ne figure pas. Il sera perdu — c’est la seule modification que Ctrl+Z ne peut pas rétablir.',
  'confirm.rebuildAnyway': 'Reconstruire quand même',
  'confirm.keep': 'Continuer l’édition',
  /* Ouvrir une ébauche remplace la scène en entier : la même perte qu’une
     reconstruction, donc le même avertissement et la même distinction
     singulier / pluriel. */
  'confirm.openTitle': 'Abandonner les éléments tracés ?',
  'confirm.openTitleOne': 'Abandonner l’élément tracé ?',
  'confirm.openOverDrawn':
    'Ouvrir une ébauche remplace tout ce qui est à l’écran, où {n} bâtiments et arbres tracés à la main ne figurent pas. Ils seront perdus — c’est la seule modification que Ctrl+Z ne peut pas rétablir.',
  'confirm.openOverDrawnOne':
    'Ouvrir une ébauche remplace tout ce qui est à l’écran, où votre élément tracé à la main ne figure pas. Il sera perdu — c’est la seule modification que Ctrl+Z ne peut pas rétablir.',
  'confirm.openAnyway': 'Ouvrir quand même',
  'confirm.overwriteTitle': 'Remplacer « {name} » ?',
  'confirm.overwriteSlot':
    'Une ébauche de ce nom est déjà enregistrée dans ce navigateur. L’écraser est irréversible.',
  'confirm.overwriteAnyway': 'Le remplacer',
  'confirm.deleteSlotTitle': 'Supprimer « {name} » ?',
  'confirm.deleteSlot':
    'L’ébauche sera définitivement retirée de ce navigateur. Un .ifcsite.json déjà exporté n’est pas concerné.',
  'confirm.deleteAnyway': 'Le supprimer',
  'confirm.cancel': 'Annuler',

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
  'err.crsUnknown': '{epsg} ne figure pas dans l’index des SCR.',
  'err.crsIndexUnavailable':
    'L’index des SCR n’a pas pu être chargé. Choisissez la zone UTM automatique, ou rechargez la page.',
  'err.draftUnreadable': 'Ce fichier n’est pas une ébauche IFC Site.',
  'err.draftVersion':
    'Cette ébauche a été écrite par une version plus récente d’IFC Site (format {version}). Actualisez la page et réessayez.',
  'err.draftCorrupt': 'L’ébauche est incomplète et ne peut pas être ouverte.',
  'err.slotsUnavailable':
    'Ce navigateur n’enregistrera pas d’ébauches — navigation privée, très probablement. Exportez plutôt un fichier d’ébauche.',

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
      body: 'Le rectangle que vous posez sur le fond OpenStreetMap — deux clics de coin, ou un glisser — constitue toute la définition du site. Rien n’est sélectionné tant que vous ne l’avez pas tracé : ses limites partent vers Overpass et le WFS de l’IGN comme bbox, dimensionnent la grille de terrain et découpent tout polygone qui franchit le bord. C’est un rectangle WGS84 : dans un SCR projeté il est donc très légèrement pivoté par la convergence des méridiens ; la boîte de découpe locale est prise sur le coin le plus extérieur, afin que rien de ce que vous avez tracé ne soit rogné. Les côtés sont maintenus par défaut entre 100 m et 2000 m — au-delà, Overpass et le WFS commencent à refuser, et c’est dans Avancé que vous décidez à quelle distance de cette limite naviguer. Les tuiles du fond de plan et la recherche de lieu proviennent d’OpenStreetMap et de Nominatim ; ce sont des services gratuits, gardez donc les requêtes légères.',
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
