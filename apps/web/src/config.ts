export interface AppConfig {
  apiUrl: string
  cognito: { authority: string; clientId: string; domain: string }
  appUrl: string
}

const strip = (s: string) => s.replace(/\/+$/, '')

export function readConfig(env: Record<string, string | undefined> = import.meta.env, appUrl = window.location.origin): AppConfig {
  const keys = ['VITE_API_URL', 'VITE_COGNITO_AUTHORITY', 'VITE_COGNITO_CLIENT_ID', 'VITE_COGNITO_DOMAIN'] as const
  const missing = keys.filter((k) => !env[k])
  if (missing.length) throw new Error(`Missing config: ${missing.join(', ')}`)
  return {
    apiUrl: strip(env.VITE_API_URL!),
    cognito: { authority: strip(env.VITE_COGNITO_AUTHORITY!), clientId: env.VITE_COGNITO_CLIENT_ID!, domain: strip(env.VITE_COGNITO_DOMAIN!) },
    appUrl: strip(appUrl),
  }
}
