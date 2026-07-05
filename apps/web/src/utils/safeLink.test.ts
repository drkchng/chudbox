import { describe, expect, it } from 'vitest'
import { isSafeHref } from './safeLink'

describe('isSafeHref', () => {
  it('allows http/https absolute URLs and scheme-less pastes', () => {
    expect(isSafeHref('https://shop.example/part')).toBe(true)
    expect(isSafeHref('http://shop.example/part?id=1&x=2')).toBe(true)
    expect(isSafeHref('www.shop.example/part')).toBe(true) // resolves relative → https
  })

  it('rejects script-bearing and non-web schemes', () => {
    expect(isSafeHref('javascript:alert(1)')).toBe(false)
    expect(isSafeHref('JaVaScRiPt:alert(1)')).toBe(false)
    expect(isSafeHref(' javascript:alert(1)')).toBe(false) // URL() trims — still js:
    expect(isSafeHref('data:text/html,<script>1</script>')).toBe(false)
    expect(isSafeHref('vbscript:x')).toBe(false)
    expect(isSafeHref('file:///etc/passwd')).toBe(false)
    expect(isSafeHref('blob:https://x/y')).toBe(false)
  })
})
