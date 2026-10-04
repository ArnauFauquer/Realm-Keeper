import { getCached } from './http'
import { apiUrl } from '@/config/env'

// Every character's and adversary's sheet, read (backend routes/sheets.py).
// Never served from the cache: a sheet just saved must show up.

/** The list, without the sheets' bodies: [{ ref, id, name, type, subtitle, image, tags, resources, folder, ... }]. */
export const fetchSheets = () => getCached(`${apiUrl}/api/sheets`, { useCache: false })

/** One sheet whole: { ref, type, sheet, warnings }. */
export const fetchSheet = (type, ref) => getCached(`${apiUrl}/api/sheets/detail`, { params: { type, ref }, useCache: false })
