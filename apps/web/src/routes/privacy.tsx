import { createFileRoute } from '@tanstack/react-router'
import { ContactLink, LegalPage } from '../components/LegalPage'

export const Route = createFileRoute('/privacy')({ component: Privacy })

function Privacy() {
  return (
    <LegalPage title="Privacy Policy" updated="22 September 2026">
      <section>
        <h2>Who</h2>
        <p>GigHunter is operated by an individual developer, reachable at <ContactLink />. This page says what the app stores about you, where, why, and how to get rid of it.</p>
      </section>
      <section>
        <h2>What we store</h2>
        <ul>
          <li><strong>Identity</strong> — your Google email address and the identifier Google assigns to you, held in AWS Cognito. Sign-up is limited to an invitation list of email addresses.</li>
          <li><strong>Profile</strong> — the skills, budget, hours, languages, stop words and free text you enter.</li>
          <li><strong>Settings and prompt overrides</strong> — polling interval, thresholds, model choice, Telegram chat id, and any prompt text you customise.</li>
          <li><strong>Connected tokens</strong> — your Telegram bot token and platform API tokens, encrypted at rest in AWS Systems Manager Parameter Store. They are used only to fetch jobs and send you messages.</li>
          <li><strong>Matched jobs, scores and feedback</strong> — kept for 60 days, then expire automatically.</li>
          <li><strong>Per-job chats</strong> — your messages and the model's replies, kept for 60 days.</li>
          <li><strong>Search runs</strong> — counts and errors per run, kept for 30 days.</li>
        </ul>
      </section>
      <section>
        <h2>Who processes it</h2>
        <ul>
          <li><strong>Amazon Web Services</strong> (us-east-1) hosts everything: Cognito, Lambda, DynamoDB, Parameter Store.</li>
          <li><strong>Anthropic Claude via Amazon Bedrock</strong> receives your profile, job posts and chat messages to score jobs and draft proposals. Bedrock does not use this content to train models.</li>
          <li><strong>Telegram</strong> delivers notifications through the bot you created, so Telegram sees the job messages and your replies to the bot.</li>
          <li><strong>Freelance platforms</strong> you connect (for example Freelancer.com) receive requests made with your own token.</li>
        </ul>
        <p>No advertising, no analytics trackers, no selling of data.</p>
      </section>
      <section>
        <h2>Why (legal basis)</h2>
        <p>Everything above exists to provide the service you asked for by signing up and configuring it. Nothing is used for any other purpose.</p>
      </section>
      <section>
        <h2>Your control</h2>
        <ul>
          <li>Edit your profile, settings and prompts at any time in the app.</li>
          <li>Remove a connected token in Settings; it is deleted from Parameter Store immediately.</li>
          <li><strong>Delete your account</strong> on the Account page. This immediately and irreversibly deletes your profile, settings, prompts, tokens, jobs, chats, runs and your Cognito identity, and unregisters the Telegram webhook.</li>
          <li>For anything else — a copy of your data, a question — write to <ContactLink />.</li>
        </ul>
      </section>
      <section>
        <h2>Cookies and local storage</h2>
        <p>The app keeps your sign-in session in your browser's local storage so a phone can reopen it without signing in again. Cognito sets a session cookie on its own domain during sign-in. That is all.</p>
      </section>
      <section>
        <h2>Changes</h2>
        <p>This policy may be updated; the date at the top tells you when.</p>
      </section>
    </LegalPage>
  )
}
