import { describe, it, expect } from 'vitest'
import { buildOidcConfig, logoutUrl, returnToFromState, signinArgs } from './oidc'

const config = { apiUrl: 'https://api.test', appUrl: 'https://app.test', cognito: { authority: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_x', clientId: 'cid', domain: 'https://auth.test' } }

describe('oidc helpers', () => {
  it('builds a code-flow config against the Cognito authority with the /login callback', () => {
    const c = buildOidcConfig(config)
    expect(c).toMatchObject({ authority: config.cognito.authority, client_id: 'cid', redirect_uri: 'https://app.test/login', response_type: 'code', scope: 'openid email profile', automaticSilentRenew: true, loadUserInfo: false })
  })
  it('signinArgs goes straight to Google and carries returnTo', () => {
    expect(signinArgs('/jobs/freelancer/1')).toEqual({ extraQueryParams: { identity_provider: 'Google' }, state: { returnTo: '/jobs/freelancer/1' } })
  })
  it('logoutUrl points at the Cognito logout endpoint with the app root', () => {
    expect(logoutUrl(config)).toBe('https://auth.test/logout?client_id=cid&logout_uri=https%3A%2F%2Fapp.test%2F')
  })
  it('returnToFromState only accepts relative in-app paths', () => {
    expect(returnToFromState({ returnTo: '/profile' })).toBe('/profile')
    expect(returnToFromState({ returnTo: 'https://evil.test' })).toBe('/jobs')
    expect(returnToFromState({ returnTo: '//evil.test' })).toBe('/jobs')
    expect(returnToFromState(undefined)).toBe('/jobs')
  })
})
