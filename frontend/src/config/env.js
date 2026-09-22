export const apiUrl = import.meta.env.VITE_API_URL || ''

// Release tag (e.g. "v0.1.73"), passed as a build arg by the release
// workflow; local and docker-compose builds don't set it.
export const appVersion = import.meta.env.VITE_APP_VERSION || 'dev'
