/**
 * The API supplies plain text. Only fold the app's named, complete JSON
 * attachment; never guess that prose, a code sample or a broken blob is noise.
 * The original attachment remains available in the conversation.
 */
export function splitSupportMessage(body: string): {
  text: string
  diagnostics: string | null
} {
  const marker = /(?:^|\n)System Diagnostics\s*(?=\{)/.exec(body)
  if (!marker) return { text: body, diagnostics: null }
  const start = marker.index + marker[0].length
  let depth = 0
  let quoted = false
  let escaped = false
  for (let i = start; i < body.length; i++) {
    const char = body[i]
    if (quoted) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
      continue
    }
    if (char === '"') quoted = true
    else if (char === '{') depth++
    else if (char === '}') {
      depth--
      if (depth === 0) {
        const diagnostics = body.slice(start, i + 1)
        try {
          JSON.parse(diagnostics)
        } catch {
          return { text: body, diagnostics: null }
        }
        return {
          text: [body.slice(0, marker.index).trim(), body.slice(i + 1).trim()]
            .filter(Boolean)
            .join('\n\n'),
          diagnostics,
        }
      }
    }
  }
  return { text: body, diagnostics: null }
}
