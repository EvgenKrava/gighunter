import { createFileRoute, Link } from '@tanstack/react-router'
import { ContactLink, LegalPage } from '../components/LegalPage'

export const Route = createFileRoute('/terms')({ component: Terms })

function Terms() {
  return (
    <LegalPage title="Terms of Service" updated="22 September 2026">
      <section>
        <h2>What GigHunter is</h2>
        <p>GigHunter watches freelance platforms for new jobs, scores each one against the profile you write, and sends the good ones to a Telegram bot you own. It also drafts proposals in a per-job chat. It is a personal tool offered to a small group of invited users during a beta.</p>
      </section>
      <section>
        <h2>Your account</h2>
        <p>You sign in with a Google account. You are responsible for keeping that account secure; GigHunter never sees or stores a password.</p>
        <p>You can delete your account at any time from the Account page. Deletion is immediate and irreversible — see the <Link to="/privacy" className="text-brand underline">Privacy Policy</Link> for exactly what is erased.</p>
      </section>
      <section>
        <h2>Your keys, your responsibility</h2>
        <p>Notifications go through a Telegram bot token you create, and jobs are fetched with API tokens from the platforms you connect (for example Freelancer.com). By connecting a token you confirm you are allowed to use it this way under that platform's own terms, and you accept that GigHunter calls those services on your behalf with it. Remove a token at any time in Settings.</p>
      </section>
      <section>
        <h2>Acceptable use</h2>
        <ul>
          <li>Use GigHunter only for your own freelance work.</li>
          <li>Do not use it to spam platforms or clients, scrape at abusive rates, or send proposals you have not reviewed.</li>
          <li>Do not attempt to access other users' data or to disrupt the service.</li>
        </ul>
      </section>
      <section>
        <h2>AI-generated content</h2>
        <p>Scores and proposal drafts are produced by a large language model. They can be wrong, biased or miss context. You decide what to send and to whom; GigHunter is not a party to any contract you enter with a client.</p>
      </section>
      <section>
        <h2>Beta, availability and cost</h2>
        <p>The service is provided as-is and as-available, without warranty of any kind. It may change, pause or shut down without notice. Model calls are limited per run to control cost, and the operator may throttle or suspend accounts that generate unreasonable load.</p>
      </section>
      <section>
        <h2>Liability</h2>
        <p>To the extent permitted by law, the operator is not liable for lost opportunities, lost income, platform sanctions resulting from your use of connected tokens, or any indirect or consequential loss arising from the use of GigHunter.</p>
      </section>
      <section>
        <h2>Changes and contact</h2>
        <p>These terms may be updated; the date at the top tells you when. Continued use after a change means you accept it. Questions go to <ContactLink />.</p>
      </section>
    </LegalPage>
  )
}
