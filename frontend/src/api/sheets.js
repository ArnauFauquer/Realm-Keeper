import { getCached } from './http'
import { apiUrl } from '@/config/env'

// Every sheet written in the vault's notes (backend routes/sheets.py). The
// catalog follows the notes, so it is never served from the cache.

/** The list, without the sheets' bodies: [{ ref, id, name, type, subtitle, image, tags, resources, note_id, ... }]. */
export const fetchSheets = () => getCached(`${apiUrl}/api/sheets`, { useCache: false })

/** One sheet whole: { ref, note_id, note_title, sheet, warnings }. */
export const fetchSheet = (ref) => getCached(`${apiUrl}/api/sheets/detail`, { params: { ref }, useCache: false })
