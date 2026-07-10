import { Link } from 'react-router-dom'
import { TERMS_EFFECTIVE_DATE, TOS_VERSION } from '@chudbox/shared'
import LegalShell, { Bullets, ContactEmail, Em, Para, Section } from '../components/legal/LegalShell'

export default function Terms() {
  return (
    <LegalShell title="Terms of Service" effectiveDate={TERMS_EFFECTIVE_DATE} subtitle={`Version ${TOS_VERSION}`}>
      <Section title="1. What Chudbox is">
        <Para>
          Chudbox (chudbox.com) is a car build and maintenance tracker: log your cars, mods,
          maintenance, mileage, parts, to-dos and photos, and optionally share a read-only view of a
          build. It is a personal project operated by Felix Rouleau, an individual based in Quebec,
          Canada (&ldquo;we&rdquo;, &ldquo;us&rdquo;). It is not a company, and it currently has no
          paid features.
        </Para>
      </Section>

      <Section title="2. Accepting these terms">
        <Para>
          By using chudbox.com you agree to these terms; creating an account asks you to confirm
          that explicitly. If you do not agree, do not use the site.
        </Para>
        <Para>
          You must be at least <Em>14 years old</Em> to create an account. If the law where you live
          sets a higher minimum age for consenting to terms like these or to the processing of your
          personal information (for example 16 in parts of the European Union), you must meet that
          age or have a parent or guardian&rsquo;s permission.
        </Para>
      </Section>

      <Section title="3. Local-first: your browser holds your garage">
        <Para>
          Without an account, everything you enter is stored <Em>only in your browser</Em>. It never
          reaches us, which also means we cannot recover it: clearing your browser data erases it.
          Use Settings &rarr; Backup &amp; data to export a backup file, and keep that file safe.
        </Para>
      </Section>

      <Section title="4. Accounts">
        <Para>
          An account is optional. It adds cross-device sync, cloud backup and sharing. You need a
          working email address, you are responsible for keeping your password safe and for what
          happens under your account, and the account is for you personally. You can delete your
          account at any time in Settings; deletion is immediate and permanent (the{' '}
          <Link to="/privacy" className="font-medium text-accent underline-offset-2 hover:underline">
            Privacy Policy
          </Link>{' '}
          describes exactly what is erased).
        </Para>
      </Section>

      <Section title="5. Your content">
        <Para>
          Your garage data and photos are <Em>yours</Em>. So that we can run the service, you grant
          us a non-exclusive, worldwide, royalty-free licence to host, store, reproduce and display
          your content, only as needed to operate Chudbox: syncing it between your devices, storing
          your photos, and rendering the share pages and link previews you create. This licence ends
          when you delete the content or your account, except for the short backup-expiry window
          described in the Privacy Policy.
        </Para>
        <Para>
          Only upload content you have the right to use, and nothing illegal.
        </Para>
      </Section>

      <Section title="6. Sharing and listings">
        <Para>
          Share links are opt-in and public: <Em>anyone who has the link</Em> (including anyone it
          is forwarded to) can see that build&rsquo;s shared view. You choose each link&rsquo;s
          scope, and you can revoke a link at any time. Opt-in details (your display name, VIN,
          licence plate, price) appear only if you turned them on.
        </Para>
        <Para>
          For-sale listings are informational only. Chudbox is not a marketplace, is not a party to
          any sale, processes no payments and verifies nothing about a listed car. Buy and sell at
          your own judgment.
        </Para>
      </Section>

      <Section title="7. Acceptable use">
        <Para>Do not:</Para>
        <Bullets
          items={[
            <>upload content that is illegal, infringes someone else&rsquo;s rights, or exposes someone else&rsquo;s personal information without their consent;</>,
            <>upload sexual content involving minors (zero tolerance; it is reported to the relevant authorities);</>,
            <>upload sexually explicit, hateful or harassing content;</>,
            <>try to break, probe or overload the service, evade rate limits, or access other users&rsquo; data;</>,
            <>impersonate someone else or misrepresent a listing;</>,
            <>scrape shared pages at scale with automated tools.</>,
          ]}
        />
        <Para>We may remove content or suspend accounts that break these rules.</Para>
      </Section>

      <Section title="8. Reporting content">
        <Para>
          If a shared build contains something illegal, infringing or otherwise against these terms,
          email <ContactEmail /> with the share link. We review reports and may remove content,
          revoke share links or terminate accounts.
        </Para>
      </Section>

      <Section title="9. Ending things">
        <Para>
          You can stop using Chudbox at any time and delete your account in Settings. We may suspend
          or terminate accounts that violate these terms or where the law requires it. If the
          service ever shuts down, we will post reasonable notice on the site first so you can
          export your data; data stored locally in your browser is unaffected.
        </Para>
      </Section>

      <Section title="10. The service will change">
        <Para>
          Chudbox is free today. Features may change, be added or be removed. If a paid tier ever
          exists, nothing will be charged without your explicit sign-up. We aim to keep the service
          available but promise no uptime: it is a personal project, run with care but without a
          service-level agreement.
        </Para>
      </Section>

      <Section title="11. Disclaimers">
        <Para>
          Chudbox is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, without warranties
          of any kind to the extent permitted by law. It is a record-keeping tool: maintenance
          schedules, mileage figures and due reminders reflect what you entered and are{' '}
          <Em>not professional automotive advice</Em>: verify safety-critical work with a qualified
          mechanic. Shared builds and listings are user content; we do not verify them. Keep your
          own backups with the built-in export.
        </Para>
      </Section>

      <Section title="12. Liability">
        <Para>
          To the maximum extent permitted by applicable law, we are not liable for indirect,
          incidental or consequential damages, or for loss of data caused by your browser, your
          devices, or a missing backup, and our total liability for any claim is limited to CAD $50.
          Nothing in these terms excludes or limits liability that cannot be excluded under
          applicable law, including the law of Quebec.
        </Para>
      </Section>

      <Section title="13. Changes to these terms">
        <Para>
          We may update these terms. The current version and effective date are shown at the top of
          this page. For material changes we will show a notice in the app, and continuing to use
          Chudbox after the effective date means you accept the new terms.
        </Para>
      </Section>

      <Section title="14. Governing law">
        <Para>
          These terms are governed by the laws of the Province of Quebec and the applicable laws of
          Canada, and disputes belong to the courts of Quebec. If you use Chudbox as a consumer,
          this clause does not deprive you of protections granted by mandatory law where you live.
        </Para>
      </Section>

      <Section title="15. Contact">
        <Para>
          <ContactEmail />, for anything about these terms, content reports, or your data.
        </Para>
      </Section>
    </LegalShell>
  )
}
