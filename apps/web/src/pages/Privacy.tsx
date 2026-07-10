import { Link } from 'react-router-dom'
import { PRIVACY_EFFECTIVE_DATE } from '@chudbox/shared'
import LegalShell, { Bullets, ContactEmail, Em, Para, Section } from '../components/legal/LegalShell'

interface CollectedRow {
  data: string
  when: string
  why: string
}

const COLLECTED: CollectedRow[] = [
  {
    data: 'Email, display name, password (stored only as a hash)',
    when: 'You create an account',
    why: 'Signing you in; account recovery',
  },
  {
    data: 'The Terms version you accepted',
    when: 'You create an account',
    why: 'Proof of your consent',
  },
  {
    data: 'Your garage data: cars (including optional VIN and licence plate), mods, maintenance, mileage check-ins, wishlist, to-dos, issues, notes',
    when: 'You are signed in and sync is on',
    why: 'Cross-device sync, cloud backup, and the share pages you create',
  },
  {
    data: 'Photos you upload',
    when: 'You are signed in',
    why: 'Storing and showing your car photos',
  },
  {
    data: 'Your Watching list: the share links you save and any nickname you give them',
    when: 'You save a shared build while signed in',
    why: 'Keeping your Watching list in sync',
  },
  {
    data: 'Session records: IP address and browser user-agent',
    when: 'Each sign-in',
    why: 'Security: recognizing sessions and investigating abuse',
  },
  {
    data: 'IP address (short-lived counters)',
    when: 'Every request',
    why: 'Rate limiting and abuse protection (never profiling)',
  },
  {
    data: 'Share-link view count',
    when: 'Someone opens your share link',
    why: 'A simple counter shown to you; who viewed is not recorded',
  },
  {
    data: 'Email delivery data (your address, the message)',
    when: 'We send a verification or password-reset email',
    why: 'Getting the email to you (delivered via Resend)',
  },
  {
    data: 'Operational logs at our host (may include IP and requested URL)',
    when: 'Automatic, short retention',
    why: 'Debugging and security',
  },
]

export default function Privacy() {
  return (
    <LegalShell title="Privacy Policy" effectiveDate={PRIVACY_EFFECTIVE_DATE}>
      <Section title="Who is responsible">
        <Para>
          Chudbox (chudbox.com) is run by <Em>Felix Rouleau</Em>, an individual based in Quebec,
          Canada, who is also the person responsible for the protection of personal information
          under Quebec&rsquo;s Law 25. Contact: <ContactEmail />.
        </Para>
      </Section>

      <Section title="The short version">
        <Para>
          Chudbox is local-first: <Em>without an account, your garage never leaves your browser</Em>{' '}
          and we receive nothing. With an account, we store only what syncing, backup and sharing
          need. No ads, no analytics trackers, no selling data, no marketing email. Deleting your
          account erases everything.
        </Para>
      </Section>

      <Section title="What we collect, and why">
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[560px] text-left text-meta">
            <thead>
              <tr className="border-b border-border bg-surface">
                <th className="px-4 py-3 font-semibold text-text-primary">Data</th>
                <th className="px-4 py-3 font-semibold text-text-primary">When</th>
                <th className="px-4 py-3 font-semibold text-text-primary">Why</th>
              </tr>
            </thead>
            <tbody>
              {COLLECTED.map((row) => (
                <tr key={row.data} className="border-b border-border/60 last:border-b-0 align-top">
                  <td className="px-4 py-3 text-text-primary">{row.data}</td>
                  <td className="px-4 py-3 text-text-secondary">{row.when}</td>
                  <td className="px-4 py-3 text-text-secondary">{row.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Para>
          We collect only what each feature needs, purpose by purpose, and consent boxes are never
          pre-checked. Data you enter while signed out (cars, photos, settings) stays in your
          browser&rsquo;s local storage; we never receive it.
        </Para>
      </Section>

      <Section title="What we don't do">
        <Bullets
          items={[
            <>no analytics, advertising or third-party trackers;</>,
            <>no profiling and no automated decision-making;</>,
            <>no selling, renting or trading personal information, ever;</>,
            <>no marketing email: account email only (verification, password reset);</>,
            <>no deliberate collection of sensitive personal information; please keep it out of your notes too.</>,
          ]}
        />
      </Section>

      <Section title="Cookies and local storage">
        <Para>
          One <Em>essential session cookie</Em> keeps you signed in; it exists only after you sign
          in. Our host Cloudflare may set its own strictly necessary security cookies. There is
          nothing optional or cross-site, so there is no cookie banner; this section is the full
          disclosure. The garage itself lives in your browser&rsquo;s local storage (IndexedDB),
          which never leaves your device unless you sign in and sync.
        </Para>
      </Section>

      <Section title="Where your data is processed">
        <Para>
          Chudbox runs on <Em>Cloudflare</Em> (Workers, D1, Durable Objects, R2 storage) and sends
          account email through <Em>Resend</Em>, both United States companies with global
          infrastructure. Your personal information is therefore stored and processed{' '}
          <Em>outside Quebec and Canada</Em>, mainly in the United States. Before choosing these
          providers we assessed the transfer as Law 25 requires (s.17) and concluded the information
          receives adequate protection: encrypted in transit, access-controlled, and covered by each
          provider&rsquo;s data-processing agreement.
        </Para>
      </Section>

      <Section title="Who can see your data">
        <Para>Nobody, apart from:</Para>
        <Bullets
          items={[
            <>the processors above, strictly to run the service;</>,
            <>
              people you give a share link to: a share link makes that build&rsquo;s shared view
              public to whoever has the link, and opt-in details (display name, VIN, plate, price)
              appear only if you enabled them;
            </>,
            <>authorities, where the law genuinely requires it.</>,
          ]}
        />
        <Para>There are no third-party integrations, ad networks or data partners.</Para>
      </Section>

      <Section title="Your rights">
        <Para>
          You can <Em>access</Em>, <Em>correct</Em>, <Em>export</Em> and <Em>delete</Em> your
          personal information, <Em>withdraw consent</Em>, and ask us to stop disseminating it.
          The fastest paths are built in:
        </Para>
        <Bullets
          items={[
            <>
              <Em>Export (portability):</Em> Settings &rarr; Backup &amp; data downloads a complete,
              structured copy of your garage at any time.
            </>,
            <>
              <Em>Delete:</Em> Settings &rarr; Delete account immediately and permanently erases
              your account, your synced garage, your uploaded images and your share links. Residual
              copies in our providers&rsquo; automatic recovery snapshots expire within 30 days.
            </>,
          ]}
        />
        <Para>
          For anything else, email <ContactEmail />; we respond within 30 days. If you are not
          satisfied, you may complain to the Commission d&rsquo;accès à l&rsquo;information du
          Québec (cai.gouv.qc.ca).
        </Para>
      </Section>

      <Section title="If you are in the EEA or UK (GDPR)">
        <Para>
          The controller is Felix Rouleau (contact above). We process personal data on three legal
          bases: <Em>performance of a contract</Em> (providing the service described in the{' '}
          <Link to="/terms" className="font-medium text-accent underline-offset-2 hover:underline">
            Terms
          </Link>
          ), <Em>legitimate interests</Em> (security, rate limiting, abuse prevention), and{' '}
          <Em>consent</Em> for optional choices such as showing your display name on shares
          (withdrawable at any time in Settings). Beyond the rights above, you may also restrict or
          object to processing, and you may lodge a complaint with your local supervisory
          authority. Transfers to our U.S. processors rely on those providers&rsquo; recognized
          safeguards (EU standard contractual clauses and/or adequacy-framework certification).
        </Para>
      </Section>

      <Section title="Retention">
        <Bullets
          items={[
            <>Account and garage data: kept while your account exists, erased on deletion (recovery snapshots expire within 30 days).</>,
            <>Sessions: expire automatically; rate-limit counters are short-lived.</>,
            <>Verification and password-reset links: expire within about an hour.</>,
            <>Local browser data: yours, on your device, until you clear it.</>,
          ]}
        />
      </Section>

      <Section title="Children">
        <Para>
          Chudbox is not directed at children under 14. If you are under 14, do not create an
          account without a parent or guardian&rsquo;s consent. If we learn we hold a child&rsquo;s
          personal information collected without the required consent, we delete it.
        </Para>
      </Section>

      <Section title="Security incidents">
        <Para>
          If a confidentiality incident presents a risk of serious injury, we will promptly notify
          the Commission d&rsquo;accès à l&rsquo;information and the people affected, and we keep a
          register of incidents, as Law 25 requires.
        </Para>
      </Section>

      <Section title="Changes">
        <Para>
          Updates are posted here with a new effective date; material changes also get a notice in
          the app.
        </Para>
      </Section>

      <Section title="Contact">
        <Para>
          Felix Rouleau, the person responsible for the protection of personal information:{' '}
          <ContactEmail />.
        </Para>
      </Section>
    </LegalShell>
  )
}
