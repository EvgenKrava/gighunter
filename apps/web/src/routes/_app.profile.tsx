import { createFileRoute } from '@tanstack/react-router'
import { useProfile, useSaveProfile } from '../api/hooks'
import { useToast } from '../components/Toast'
import { Spinner } from '../components/ui/Spinner'
import { ProfileForm } from '../features/profile/ProfileForm'

export const Route = createFileRoute('/_app/profile')({ component: ProfilePage })

function ProfilePage() {
  const profile = useProfile()
  const save = useSaveProfile()
  const toast = useToast()
  if (profile.isLoading) return <div className="py-8 text-center text-slate-500"><Spinner /></div>
  if (profile.error) return <p className="text-red-600">{profile.error.message}</p>
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Profile</h1>
      {profile.data === null && <p className="rounded-lg bg-indigo-50 p-3 text-sm text-indigo-900 dark:bg-indigo-900/30 dark:text-indigo-100">Start here: the profile is what every job is scored against.</p>}
      <ProfileForm key={profile.data?.updatedAt ?? 'new'} initial={profile.data ?? null} saving={save.isPending}
        onSubmit={(v) => save.mutateAsync(v).then(() => toast('Profile saved', 'success')).catch((e) => toast(e.message, 'error'))} />
    </div>
  )
}
