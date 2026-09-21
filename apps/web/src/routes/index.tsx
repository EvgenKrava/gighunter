import { createFileRoute, Link } from '@tanstack/react-router'
import { Bot, MessageSquareText, Radar } from 'lucide-react'
import { useAuthUser } from '../auth/useAuthUser'
import { Button } from '../components/ui/Button'

export const Route = createFileRoute('/')({ component: Landing })

const features = [
  { Icon: Radar, title: 'Profile-based matching', text: 'Every new job is scored against your skills, budget and hours by Claude — only the good ones reach you.' },
  { Icon: MessageSquareText, title: 'Chat that drafts proposals', text: 'Each job has a chat with full context: your profile, the post, the score. Ask for a proposal, an estimate, or the questions to send.' },
  { Icon: Bot, title: 'Your bot, your keys', text: 'Notifications go to your own Telegram bot; platform tokens stay in your account. Pause the search any time.' },
]

export function Landing() {
  const { user, isLoading, signIn } = useAuthUser()
  const onSignIn = () => {
    const returnTo = sessionStorage.getItem('returnTo') ?? '/jobs'
    sessionStorage.removeItem('returnTo')
    signIn(returnTo)
  }
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 py-10">
      <div className="flex items-center gap-2 text-brand"><Radar size={28} /><span className="text-xl font-semibold">GigHunter</span></div>
      <h1 className="mt-8 text-3xl font-bold leading-tight sm:text-4xl">Your evening-gig radar.</h1>
      <p className="mt-3 max-w-xl text-lg text-slate-600 dark:text-slate-300">AI-scored freelance jobs that fit a few free hours, delivered to your Telegram — with a chat that writes the proposal for you.</p>
      <div className="mt-6">
        {user ? (
          <Link to="/jobs" className="inline-flex min-h-12 items-center rounded-lg bg-brand px-5 text-base font-medium text-white">Open app</Link>
        ) : (
          <Button onClick={onSignIn} loading={isLoading} className="min-h-12 px-5">Sign in with Google</Button>
        )}
      </div>
      <ul className="mt-12 grid gap-4 sm:grid-cols-3">
        {features.map(({ Icon, title, text }) => (
          <li key={title} className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
            <Icon className="text-brand" size={22} />
            <h2 className="mt-2 font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{text}</p>
          </li>
        ))}
      </ul>
      <footer className="mt-auto pt-12 text-sm text-slate-500">
        <a className="underline" href="https://github.com/EvgenKrava/gighunter">GitHub</a> · Invite-only during beta.
      </footer>
    </main>
  )
}
