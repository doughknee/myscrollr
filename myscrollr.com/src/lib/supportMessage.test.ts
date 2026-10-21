import { describe, expect, it } from 'vitest'
import { splitSupportMessage } from './supportMessage'

describe('support message attachments', () => {
  it('keeps the conversation before and after a complete diagnostics attachment', () => {
    const diagnostics =
      '{"os":"windows","nested":{"logs":["a } brace","quote \\""]}}'
    expect(
      splitSupportMessage(
        `My ticker stopped.\n\nSystem Diagnostics${diagnostics}\nPlease help.`,
      ),
    ).toEqual({ text: 'My ticker stopped.\n\nPlease help.', diagnostics })
  })

  it.each([
    'Here is my code: {"test":true}',
    'System Diagnostics are not working.',
    'System Diagnostics {broken}',
    'System Diagnostics {"truncated":true',
    'I wrote System Diagnostics {"example":true} in the editor.',
  ])('never hides prose or unparseable attachments: %s', (body) => {
    expect(splitSupportMessage(body)).toEqual({ text: body, diagnostics: null })
  })

  it('preserves a diagnostic-only message without inventing user prose', () => {
    expect(splitSupportMessage('System Diagnostics\n{"os":"linux"}')).toEqual({
      text: '',
      diagnostics: '{"os":"linux"}',
    })
  })
})
