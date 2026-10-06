/** A new id for something in a saved document (a pin, a path, a vista's
 * asset). crypto.randomUUID only exists in a secure context, so a page served
 * over plain HTTP on the local network gets a random one of its own. */
export function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
}
