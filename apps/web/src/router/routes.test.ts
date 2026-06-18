import { describe, expect, it } from 'vitest'
import { matchPath } from 'react-router-dom'
import { ROUTES } from './routes'

// "BrowserRouter routes resolve": react-router's matchPath is a pure matcher
// (no DOM), so we can assert each clean path resolves to exactly the pattern
// App registers — and pulls the right param out — without rendering the tree.
describe('clean-URL routes resolve', () => {
  it('matches the garage root', () => {
    expect(matchPath(ROUTES.garage, '/')).not.toBeNull()
  })

  it('matches a car profile and extracts :id', () => {
    const m = matchPath(ROUTES.car, '/car/42')
    expect(m?.params.id).toBe('42')
  })

  it('matches a share link and extracts :token', () => {
    const m = matchPath(ROUTES.share, '/share/abc123')
    expect(m?.params.token).toBe('abc123')
  })

  it('matches the clean auth landing paths', () => {
    expect(matchPath(ROUTES.authReset, '/auth/reset')).not.toBeNull()
    expect(matchPath(ROUTES.authVerified, '/auth/verified')).not.toBeNull()
  })

  it('does not cross-match a share path onto the car route', () => {
    expect(matchPath(ROUTES.car, '/share/abc')).toBeNull()
  })
})
