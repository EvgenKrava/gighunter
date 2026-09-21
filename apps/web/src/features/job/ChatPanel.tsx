import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import Markdown from 'react-markdown'
import { Copy, RotateCcw, SendHorizontal } from 'lucide-react'
import type { Chat, ChatMessage, MatchRef, QuickAction } from '@gighunter/core/schema'
import { useResetChat, useSendChat } from '../../api/hooks'
import { useToast } from '../../components/Toast'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'

export function ChatPanel({ matchRef, chat, quickActions }: { matchRef: MatchRef; chat: Chat | null; quickActions: QuickAction[] }) {
  const send = useSendChat(matchRef)
  const reset = useResetChat(matchRef)
  const toast = useToast()
  const [draft, setDraft] = useState('')
  const [pendingText, setPendingText] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const messages: ChatMessage[] = chat?.messages ?? []
  // The `chat` prop only grows once the parent's match query refetches (via the
  // invalidation `useSendChat` triggers), which doesn't happen synchronously after
  // a send. Track locally whether this session has sent anything so "Reset chat"
  // appears right away instead of waiting on that refetch.
  const [everSent, setEverSent] = useState(messages.length > 0)

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [messages.length, pendingText])

  const submit = (text: string) => {
    const message = text.trim()
    if (!message || send.isPending) return
    setPendingText(message)
    setEverSent(true)
    setDraft('')
    setTruncated(false)
    send.mutate(message, {
      onSuccess: (r) => setTruncated(r.truncated),
      onError: (e) => { toast(e.message, 'error'); setDraft(message) },
      onSettled: () => setPendingText(null),
    })
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(draft) } }
  const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => toast('Copied', 'success'))

  return (
    <section className="flex flex-col" aria-label="Chat">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Chat</h2>
        {everSent && <Button variant="ghost" size="sm" onClick={() => setConfirmReset(true)} aria-label="Reset chat"><RotateCcw size={16} />Reset chat</Button>}
      </div>
      <div className="space-y-3">
        {messages.length === 0 && !pendingText && <p className="text-sm text-slate-500">Ask anything about this job, or tap a quick action. The assistant knows your profile, the post and the score.</p>}
        {messages.map((m, i) => <Bubble key={i} m={m} onCopy={m.role === 'assistant' ? () => copy(m.content) : undefined} />)}
        {pendingText && (<>
          <Bubble m={{ role: 'user', content: pendingText, at: '' }} />
          <p className="text-sm text-slate-500" role="status">Thinking…</p>
        </>)}
        {truncated && <p className="text-xs text-amber-700">The reply was cut off by the length limit — ask to continue.</p>}
        <div ref={endRef} />
      </div>
      <div className="sticky bottom-16 z-30 -mx-4 mt-4 border-t border-slate-200 bg-white px-4 pb-[env(safe-area-inset-bottom)] pt-2 md:bottom-0 dark:border-slate-800 dark:bg-slate-950">
        {quickActions.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {quickActions.map((q) => <button key={q.label} type="button" disabled={send.isPending} onClick={() => submit(q.text)} className="min-h-9 rounded-full border border-slate-300 px-3 text-sm disabled:opacity-50 dark:border-slate-700">{q.label}</button>)}
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} disabled={send.isPending} rows={1} placeholder="Ask about this job…" enterKeyHint="send"
            className="max-h-40 min-h-11 flex-1 resize-none rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base outline-none focus:border-brand dark:border-slate-700 dark:bg-slate-950" />
          <Button onClick={() => submit(draft)} disabled={!draft.trim()} loading={send.isPending} aria-label="Send"><SendHorizontal size={18} /></Button>
        </div>
      </div>
      <ConfirmDialog open={confirmReset} title="Reset this chat?" body="The conversation for this job will be deleted." confirmLabel="Reset" danger
        onCancel={() => setConfirmReset(false)} onConfirm={() => { setConfirmReset(false); reset.mutate(undefined, { onError: (e) => toast(e.message, 'error') }) }} />
    </section>
  )
}

function Bubble({ m, onCopy }: { m: ChatMessage; onCopy?: () => void }) {
  const mine = m.role === 'user'
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`relative max-w-[88%] rounded-2xl px-3.5 py-2.5 text-base ${mine ? 'bg-brand text-white' : 'bg-slate-100 dark:bg-slate-800'}`}>
        {mine ? <p className="whitespace-pre-wrap">{m.content}</p> : <div className="md"><Markdown>{m.content}</Markdown></div>}
        {onCopy && <button type="button" onClick={onCopy} aria-label="Copy" className="mt-1 inline-flex min-h-8 items-center gap-1 text-xs text-slate-500"><Copy size={12} />Copy</button>}
      </div>
    </div>
  )
}
