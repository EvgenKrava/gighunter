import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { ExternalLink } from 'lucide-react'
import { useDeleteAccount } from '../api/hooks'
import { useAuthUser } from '../auth/useAuthUser'
import { useToast } from '../components/Toast'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'

export const Route = createFileRoute('/_app/account')({ component: AccountPage })

function AccountPage() {
  const { user, signOut } = useAuthUser()
  const del = useDeleteAccount()
  const toast = useToast()
  const [confirm, setConfirm] = useState(false)
  const onDelete = () => {
    setConfirm(false)
    // Success ends with the normal sign-out: the Cognito user is gone, but the hosted-UI session cookie is
    // not, and leaving it would make the next "Sign in with Google" trip over a user that no longer exists.
    del.mutate(undefined, { onSuccess: () => signOut(), onError: (e) => toast(`Could not delete the account: ${e.message}`, 'error') })
  }
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Account</h1>
      <Card className="space-y-3">
        <h2 className="font-semibold">Sign-in</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">Signed in with Google as <span className="font-medium text-slate-900 dark:text-slate-100">{user?.email}</span>.</p>
        <p className="text-sm text-slate-600 dark:text-slate-300">GigHunter has no password of its own — your Google account is the key. Security settings, two-factor and recovery live there.</p>
        <a className="inline-flex min-h-11 items-center gap-1.5 text-sm text-brand underline" href="https://myaccount.google.com/security" target="_blank" rel="noreferrer">Manage Google account <ExternalLink size={14} /></a>
      </Card>
      <Card className="space-y-3 border-red-200 dark:border-red-900/60">
        <h2 className="font-semibold text-red-700 dark:text-red-400">Danger zone</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">Deleting your account removes your profile, settings, connected tokens, matched jobs, chats and search history, and your sign-in. This happens immediately and cannot be undone.</p>
        <Button variant="danger" loading={del.isPending} onClick={() => setConfirm(true)}>Delete account</Button>
      </Card>
      <ConfirmDialog open={confirm} title="Delete your account?" body="Everything GigHunter stores about you is erased right away. There is no grace period and no way back." confirmLabel="Delete everything" danger onCancel={() => setConfirm(false)} onConfirm={onDelete} />
    </div>
  )
}
