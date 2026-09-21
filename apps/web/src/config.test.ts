import { describe, it, expect } from 'vitest'
import { readConfig } from './config'

const env = {
  VITE_API_URL: 'https://api.test/',
  VITE_COGNITO_AUTHORITY: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_x',
  VITE_COGNITO_CLIENT_ID: 'client',
  VITE_COGNITO_DOMAIN: 'https://auth.test',
}

describe('readConfig', () => {
  it('reads and trims trailing slashes', () => {
    const c = readConfig(env, 'https://app.test')
    expect(c.apiUrl).toBe('https://api.test')
    expect(c.cognito).toEqual({ authority: env.VITE_COGNITO_AUTHORITY, clientId: 'client', domain: 'https://auth.test' })
    expect(c.appUrl).toBe('https://app.test')
  })
  it('throws naming every missing key', () => {
    expect(() => readConfig({ VITE_API_URL: 'x' }, 'https://app.test')).toThrow(/VITE_COGNITO_AUTHORITY.*VITE_COGNITO_CLIENT_ID.*VITE_COGNITO_DOMAIN/)
  })
})
