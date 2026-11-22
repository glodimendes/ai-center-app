import { describe, expect, it } from 'vitest'
import { failureMessage } from '../electron/main/agents/engines/process'

describe('failureMessage', () => {
  it('never shows just the Codex stdin banner', () => {
    const msg = failureMessage('Reading additional input from stdin...\nOpenAI Codex v0.170.0\n--------\nmodel: gpt-5.6-luna\n', 1, 'codex')
    expect(msg).not.toMatch(/Reading additional input/)
    expect(msg).toMatch(/codex stopped \(exit code 1\)/)
  })
  it('prefers the real error line', () => {
    const msg = failureMessage('Reading additional input from stdin...\nERROR: You\'ve hit your usage limit.\nsome trailing line\n', 1)
    expect(msg).toBe("ERROR: You've hit your usage limit.")
  })
})
