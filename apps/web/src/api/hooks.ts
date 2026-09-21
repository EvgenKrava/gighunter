import { useCallback, useMemo } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import type { Chat, Match, MatchRef, MatchStatus, Profile, ProfileInput, Prompts, PromptsPatch, QuickAction, Run, Settings, SettingsPatch } from '@gighunter/core/schema'
import { useAuthUser } from '../auth/useAuthUser'
import { apiFetch, ApiError, type ApiInit } from './client'

export type { Chat, Match, MatchRef, MatchStatus, Profile, ProfileInput, Prompts, PromptsPatch, QuickAction, Run, Settings, SettingsPatch }
export type PublicSettings = Omit<Settings, 'telegram'> & { telegram: Omit<Settings['telegram'], 'webhookSecret'> }
export interface PromptsResponse { defaults: { scoring: string; chat: string; quickActions: QuickAction[] }; overrides: Partial<Prompts>; placeholders: string[] }
export interface MatchPage { items: Match[]; cursor?: string }
export interface ChatTurn { reply: string; truncated: boolean; usage: { inputTokens: number; outputTokens: number } }

const PAGE = 30

export function useApi() {
  const { config } = useRouter().options.context
  const { user, signOut } = useAuthUser()
  const token = user?.idToken
  const call = useCallback(
    async <T,>(path: string, init?: ApiInit): Promise<T> => {
      try {
        return await apiFetch<T>(config.apiUrl, token, path, init)
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) signOut()
        throw e
      }
    },
    [config.apiUrl, token, signOut],
  )
  return useMemo(
    () => ({
      get: <T,>(path: string) => call<T>(path),
      put: <T,>(path: string, json: unknown) => call<T>(path, { method: 'PUT', json }),
      patch: <T,>(path: string, json: unknown) => call<T>(path, { method: 'PATCH', json }),
      post: <T,>(path: string, json?: unknown) => call<T>(path, { method: 'POST', ...(json !== undefined ? { json } : {}) }),
      del: <T,>(path: string) => call<T>(path, { method: 'DELETE' }),
    }),
    [call],
  )
}

const refPath = (ref: MatchRef) => `/matches/${ref.platform}/${encodeURIComponent(ref.externalId)}`

// --- queries ---------------------------------------------------------------
export function useProfile() {
  const api = useApi()
  return useQuery({
    queryKey: ['profile'],
    queryFn: async (): Promise<Profile | null> => {
      try { return await api.get<Profile>('/profile') } catch (e) { if (e instanceof ApiError && e.status === 404) return null; throw e }
    },
  })
}
export function useSettings() {
  const api = useApi()
  return useQuery({ queryKey: ['settings'], queryFn: () => api.get<PublicSettings>('/settings') })
}
export function usePrompts() {
  const api = useApi()
  return useQuery({ queryKey: ['prompts'], queryFn: () => api.get<PromptsResponse>('/prompts') })
}
export function useMatches(status: MatchStatus) {
  const api = useApi()
  return useInfiniteQuery({
    queryKey: ['matches', status],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.get<MatchPage>(`/matches?status=${status}&limit=${PAGE}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`),
    getNextPageParam: (last) => last.cursor,
  })
}
export function useMatch(ref: MatchRef) {
  const api = useApi()
  return useQuery({ queryKey: ['match', ref.platform, ref.externalId], queryFn: () => api.get<{ match: Match; chat: Chat | null }>(refPath(ref)) })
}
export function useRuns() {
  const api = useApi()
  return useQuery({ queryKey: ['runs'], queryFn: () => api.get<Run[]>('/runs?limit=10') })
}

// --- mutations -------------------------------------------------------------
export function useSaveProfile() {
  const api = useApi(); const qc = useQueryClient()
  return useMutation({ mutationFn: (input: ProfileInput) => api.put<Profile>('/profile', input), onSuccess: (p) => qc.setQueryData(['profile'], p) })
}
export function usePatchSettings() {
  const api = useApi(); const qc = useQueryClient()
  return useMutation({ mutationFn: (patch: SettingsPatch) => api.patch<PublicSettings>('/settings', patch), onSuccess: (s) => qc.setQueryData(['settings'], s) })
}
export function useSaveToken(kind: 'telegram' | 'freelancer') {
  const api = useApi(); const qc = useQueryClient()
  return useMutation({ mutationFn: (token: string) => api.put<PublicSettings>(`/settings/${kind}/token`, { token }), onSuccess: (s) => qc.setQueryData(['settings'], s) })
}
export function useRemoveToken(kind: 'telegram' | 'freelancer') {
  const api = useApi(); const qc = useQueryClient()
  return useMutation({ mutationFn: () => api.del<PublicSettings>(`/settings/${kind}/token`), onSuccess: (s) => qc.setQueryData(['settings'], s) })
}
export function useTelegramTest() {
  const api = useApi()
  return useMutation({ mutationFn: () => api.post<void>('/settings/telegram/test') })
}
export function useSavePrompts() {
  const api = useApi(); const qc = useQueryClient()
  return useMutation({ mutationFn: (patch: PromptsPatch) => api.put<Prompts>('/prompts', patch), onSuccess: () => qc.invalidateQueries({ queryKey: ['prompts'] }) })
}
export function usePreviewPrompt() {
  const api = useApi()
  return useMutation({ mutationFn: (body: { kind: 'scoring' | 'chat'; template: string }) => api.post<{ rendered: string }>('/prompts/preview', body) })
}
export function useFeedback(ref: MatchRef) {
  const api = useApi(); const qc = useQueryClient()
  return useMutation({
    mutationFn: (feedback: 'up' | 'down') => api.post<Match>(`${refPath(ref)}/feedback`, { feedback }),
    onSuccess: (match) => {
      qc.setQueryData(['match', ref.platform, ref.externalId], (old: { match: Match; chat: Chat | null } | undefined) => (old ? { ...old, match } : old))
      void qc.invalidateQueries({ queryKey: ['matches'] })
    },
  })
}
export function useSendChat(ref: MatchRef) {
  const api = useApi(); const qc = useQueryClient()
  return useMutation({
    mutationFn: (message: string) => api.post<ChatTurn>(`${refPath(ref)}/chat`, { message }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['match', ref.platform, ref.externalId] }),
  })
}
export function useResetChat(ref: MatchRef) {
  const api = useApi(); const qc = useQueryClient()
  return useMutation({ mutationFn: () => api.del<void>(`${refPath(ref)}/chat`), onSuccess: () => qc.invalidateQueries({ queryKey: ['match', ref.platform, ref.externalId] }) })
}
export function useRunNow() {
  const api = useApi(); const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<{ status: string }>('/runs'),
    onSuccess: () => { setTimeout(() => { void qc.invalidateQueries({ queryKey: ['matches'] }); void qc.invalidateQueries({ queryKey: ['runs'] }) }, 30_000) },
  })
}
