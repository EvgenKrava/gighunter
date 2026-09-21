export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string, readonly issues?: unknown[]) {
    super(message)
    this.name = 'ApiError'
  }
}

export type ApiInit = RequestInit & { json?: unknown }

export async function apiFetch<T>(base: string, token: string | undefined, path: string, init: ApiInit = {}, fetchFn: typeof fetch = fetch): Promise<T> {
  const { json, headers, ...rest } = init
  const res = await fetchFn(`${base}${path}`, {
    ...rest,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(headers as Record<string, string> | undefined),
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  })
  if (res.status === 204) return undefined as T
  const text = await res.text()
  let body: unknown
  try { body = text ? JSON.parse(text) : undefined } catch { body = undefined }
  if (!res.ok) {
    const b = (body ?? {}) as { error?: string; code?: string; issues?: unknown[] }
    throw new ApiError(res.status, b.error ?? `HTTP ${res.status}`, b.code, b.issues)
  }
  return body as T
}
