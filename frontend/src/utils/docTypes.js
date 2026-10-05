// The kinds of document the app keeps in the Observatory's folders (backend
// services/doc_registry.py), each described once: how to word it, how the
// Observatory draws it, how a note refers to it. What an editor looks like is the
// part that differs, so that stays in each kind's modal; everything else reads from here.
//
//   resource    the URL under /api/ (and the key of the API client in api/docs.js)
//   imageField  the picture its Observatory card shows, and what a screen needs to show it
//   assetRoute  POST /<id>/<route> sets that picture to an Observatory image
//   saved       a document edited whole and saved with a button (not live): the
//               fields a save sends besides its name and description
//   screen      can be shown on the table screen, and mirrored there as it is edited
//   embeddable  a note can show it with `<type>:<id>`
//   sheet       a character or adversary: its `source` is a sheet's YAML
//               (utils/sheet.js), and a note shows it as that sheet
export const DOC_TYPES = {
  chart: {
    type: 'chart',
    resource: 'charts',
    title: 'Charts',
    plural: 'charts',
    label: 'chart',
    icon: 'mdi-map-marker-radius',
    imageField: 'image_url',
    assetRoute: 'image',
    saved: ['pins', 'paths', 'annotations'],
    screen: true,
    embeddable: true
  },
  vista: {
    type: 'vista',
    resource: 'vistas',
    title: 'Vistas',
    plural: 'vistas',
    label: 'vista',
    icon: 'mdi-image-frame',
    // (the icon a note's embed placeholder shows is not the Observatory's)
    embedIcon: 'mdi-image-filter-hdr',
    imageField: 'background_url',
    assetRoute: 'background',
    saved: ['vanishing_point', 'background_offset_y', 'assets'],
    screen: true,
    embeddable: true
  },
  encounter: {
    type: 'encounter',
    resource: 'encounters',
    title: 'Encounters',
    plural: 'encounters',
    label: 'encounter',
    icon: 'mdi-sword-cross'
  },
  character: {
    type: 'character',
    resource: 'characters',
    title: 'Characters',
    plural: 'characters',
    label: 'character',
    icon: 'mdi-account-heart-outline',
    embedIcon: 'mdi-card-account-details-outline',
    imageField: 'image',
    embeddable: true,
    sheet: true
  },
  adversary: {
    type: 'adversary',
    resource: 'adversaries',
    title: 'Adversaries',
    plural: 'adversaries',
    label: 'adversary',
    icon: 'mdi-skull-outline',
    embedIcon: 'mdi-card-account-details-outline',
    imageField: 'image',
    saved: ['source'],
    embeddable: true,
    sheet: true
  },
  battlemap: {
    type: 'battlemap',
    resource: 'battlemaps',
    title: 'Battlemaps',
    plural: 'battlemaps',
    label: 'battlemap',
    icon: 'mdi-grid'
  }
}

/** The Observatory's other kind of file: an image, worded like the documents. */
export const IMAGE_KIND = {
  type: 'image',
  title: 'Images',
  plural: 'images',
  label: 'image',
  icon: 'mdi-image-outline'
}

/** The kinds a note can embed, as `<type>:<id>`. */
export const EMBEDDABLE_TYPES = Object.values(DOC_TYPES).filter((t) => t.embeddable).map((t) => t.type)

/** The icon of a kind's embed placeholder in a note. */
export const embedIcon = (type) => DOC_TYPES[type].embedIcon || DOC_TYPES[type].icon

const pick = (doc, fields) => Object.fromEntries(fields.map((field) => [field, doc[field]]))

/** What saving a `saved` document sends: its name, description and edited fields. */
export function savePayload(docType, doc) {
  return { name: doc.name, description: doc.description, ...pick(doc, docType.saved) }
}

/**
 * What the table screen needs to draw a document as it is right now, saved or
 * not (routes/screen.py: POST /api/screen/<type>/live): its id, its picture
 * and the edited fields.
 */
export function screenPayload(docType, doc) {
  return { [`${docType.type}_id`]: doc.id, [docType.imageField]: doc[docType.imageField], ...pick(doc, docType.saved) }
}
