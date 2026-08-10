import { ShieldCheck } from "lucide-react";
import { LegalPageShell } from "@/components/legal/LegalPageShell";

export const metadata = {
  title: "Privacy Policy",
  description:
    "FilmSnaps privacy policy — what data we collect, what stays on your device, and our commitment to user privacy.",
  alternates: {
    canonical: "https://filmsnap-pro.netlify.app/privacy",
  },
};

export default function PrivacyPage() {
  return (
    <LegalPageShell
      title="Privacy Policy"
      subtitle="How we handle your data — the short version: we don't collect it"
      icon={
        <ShieldCheck className="h-10 w-10 text-amber-500" strokeWidth={1.5} />
      }
    >
      <div className="space-y-8">
        <p className="text-sm text-zinc-400">Last updated: July 2026</p>

        <Section title="Data Collection">
          <Body>
            FilmSnaps does <Bold>not</Bold> collect, store, or transmit any
            personal data to external servers. The app is designed with a
            privacy-first approach — everything stays on your device.
          </Body>
        </Section>

        <Section title="What We Store Locally">
          <Body>The following data is stored exclusively on your device:</Body>
          <Bullet text="Watch history — movies and TV shows you have watched" />
          <Bullet text="Saved/bookmarked content — your personal watchlist" />
          <Bullet text="Downloaded files — content you have saved for offline viewing" />
          <Bullet text="App settings — your preferences (server selection, subtitle options, etc.)" />
          <Bullet text="Search queries — recent searches" />
        </Section>

        <Section title="How Data Is Stored">
          <Body>
            All local data is stored using your browser&apos;s local storage and
            standard web platform APIs, or your device&apos;s file system in the
            desktop app. No data is encrypted beyond what the operating system
            provides by default. We recommend enabling device-level encryption
            in your system&apos;s security settings.
          </Body>
        </Section>

        <Section title="Third-Party Content Servers">
          <Body>
            When you stream or download content, your requests are sent directly
            to third-party content servers that are not affiliated with
            FilmSnaps. These servers may log your IP address and request details
            as part of their normal operation. FilmSnaps has no control over and
            assumes no responsibility for the data practices of these third
            parties.
          </Body>
        </Section>

        <Section title="No Tracking or Analytics">
          <Body>
            FilmSnaps does not include any analytics SDKs, tracking pixels, or
            third-party monitoring tools. We do not collect usage statistics,
            crash reports, or any telemetry data. There are no advertisements in
            the app.
          </Body>
        </Section>

        <Section title="Data Sharing">
          <Body>
            Since we collect no personal data, we share no personal data. We do
            not sell, trade, or transfer any information to third parties.
          </Body>
        </Section>

        <Section title="Children's Privacy">
          <Body>
            FilmSnaps is not directed at children under 13. We do not knowingly
            collect any information from children. If you believe a child has
            provided personal data through the app, contact us immediately.
          </Body>
        </Section>

        <Section title="Changes to This Policy">
          <Body>
            We may update this privacy policy from time to time. Changes will be
            reflected with an updated &quot;Last updated&quot; date at the top
            of this page.
          </Body>
        </Section>

        <Section title="Contact">
          <Body>
            If you have questions about this privacy policy, please reach out
            via email at <Bold>privacy@filmsnaps.app</Bold>.
          </Body>
        </Section>
      </div>
    </LegalPageShell>
  );
}

// ── Sub-components ──

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-5">
      <h2 className="mb-2 text-sm font-semibold text-[#D4A237]">{title}</h2>
      {children}
    </section>
  );
}

function Body({ children }: { children: React.ReactNode }) {
  return <p className="text-sm leading-6 text-zinc-400">{children}</p>;
}

function Bold({ children }: { children: React.ReactNode }) {
  return <span className="font-semibold text-zinc-200">{children}</span>;
}

function Bullet({ text }: { text: string }) {
  return (
    <p className="mt-2 flex items-start gap-2.5 text-sm leading-5 text-zinc-300">
      <span className="mt-1.5 text-[10px] leading-none text-[#D4A237]">■</span>
      <span>{text}</span>
    </p>
  );
}
