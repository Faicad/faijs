/**
 * XML DOM access, env-agnostic.
 *
 * Browsers (and workers) ship native DOMParser/XMLSerializer; only headless
 * node (unit tests, CLI, scripts) lacks them. `@xmldom/xmldom` is therefore
 * loaded lazily via dynamic import so it never enters the browser bundle —
 * a static `import { DOMParser } from '@xmldom/xmldom'` here would surface
 * the CJS module in Vite-served browser graphs and break on ESM named-export
 * resolution.
 *
 * Note the behavioral difference at the error boundary: native DOMParser
 * reports malformed XML via a <parsererror> document, xmldom throws. Callers
 * must treat "no usable content" as the failure signal, not the throw.
 */

// Referenced through globalThis so the dynamic import's xmldom type names
// cannot shadow the lib.dom globals inside this module.
type NativeDomParser = typeof globalThis.DOMParser
type NativeXmlSerializer = typeof globalThis.XMLSerializer

/**
 * Parse an XML string into a DOM Document (native in the browser, xmldom on node).
 * @param xml - the XML source text to parse.
 * @returns the parsed DOM Document.
 */
export async function parseXmlDocument(xml: string): Promise<Document> {
  const Native = (globalThis as { DOMParser?: NativeDomParser }).DOMParser
  if (Native) {
    return new Native().parseFromString(xml, 'application/xml')
  }
  const { DOMParser } = await import('@xmldom/xmldom')
  // xmldom's Document type conflicts with lib.dom; cast across the boundary.
  return new DOMParser().parseFromString(xml, 'application/xml') as unknown as Document
}

/**
 * Serialize a DOM node back to an XML string (native in the browser, xmldom on node).
 * @param el - the DOM element to serialize.
 * @returns the XML markup string for the element.
 */
export async function serializeXmlNode(el: Element): Promise<string> {
  const Native = (globalThis as { XMLSerializer?: NativeXmlSerializer }).XMLSerializer
  if (Native) {
    return new Native().serializeToString(el)
  }
  const { XMLSerializer } = await import('@xmldom/xmldom')
  // xmldom's own Node/Element types conflict with lib.dom (its .d.ts resolves
  // `Node` to the global in DOM-lib projects), so type the call structurally.
  const ser = new XMLSerializer() as { serializeToString(node: unknown): string }
  return ser.serializeToString(el)
}
