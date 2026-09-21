import { useState } from 'react'
import type { SettingsPatch } from '@gighunter/core/schema'
import { useRemoveToken, useSaveToken, useTelegramTest, type PublicSettings } from '../../api/hooks'
import { useToast } from '../../components/Toast'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Details } from '../../components/ui/Details'
import { TextInput } from '../../components/ui/Inputs'
import { TokenInput } from './TokenInput'

export function TelegramBlock({ settings, onPatch }: { settings: PublicSettings; onPatch: (p: SettingsPatch) => void }) {
  const save = useSaveToken('telegram'); const remove = useRemoveToken('telegram'); const test = useTelegramTest()
  const toast = useToast()
  const t = settings.telegram
  const [chatId, setChatId] = useState(t.chatId ?? '')
  const wrap = <T,>(p: Promise<T>) => p.then((r) => { toast('Saved', 'success'); return r }).catch((e) => { toast(e.message, 'error'); throw e })
  return (
    <Card className="space-y-3">
      <h2 className="text-lg font-semibold">Telegram</h2>
      <Details summary="How to connect your bot">
        <ol className="list-decimal space-y-1 pl-4">
          <li>Open <a className="underline" href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a>, send <code>/newbot</code>, copy the token.</li>
          <li>Paste it below and press <b>Save token</b> — we verify it and register the webhook.</li>
          <li>Send <code>/start</code> to your bot, or add it as an admin to a channel and post anything.</li>
          <li>The chat appears here automatically. Use <b>Send test message</b> to confirm.</li>
        </ol>
      </Details>
      <TokenInput label="Bot token" placeholder="123456789:AAExample…" tokenSet={t.tokenSet} tokenHint={t.tokenHint}
        onSave={(token) => wrap(save.mutateAsync(token))} onRemove={() => wrap(remove.mutateAsync())} />
      {t.tokenSet && (
        <div className="space-y-2 text-sm">
          <p>Bot <span className="font-medium">@{t.botUsername}</span> ✓ · webhook ✓ · chat: {t.chatId ? <span className="font-medium">{t.chatTitle ?? t.chatId} ✓</span> : <span className="text-amber-700">waiting for /start</span>}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" disabled={!t.chatId} loading={test.isPending} onClick={() => test.mutate(undefined, { onSuccess: () => toast('Test message sent', 'success'), onError: (e) => toast(e.message, 'error') })}>Send test message</Button>
          </div>
          <Details summary="Set chat id manually">
            <div className="flex gap-2">
              <TextInput aria-label="Chat id" className="mt-0" inputMode="numeric" placeholder="-1001234567890" value={chatId} onChange={(e) => setChatId(e.target.value)} />
              <Button size="sm" variant="secondary" onClick={() => onPatch({ telegram: { chatId: chatId.trim() } })} disabled={!chatId.trim()}>Save</Button>
            </div>
          </Details>
        </div>
      )}
    </Card>
  )
}
