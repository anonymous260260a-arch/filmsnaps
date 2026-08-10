import { Scale } from "lucide-react";
import { LegalPageShell } from "@/components/legal/LegalPageShell";

export const metadata = {
  title: "Legal & DMCA",
  description:
    "FilmSnaps Legal & Disclaimer — content notice, no-affiliation statement, educational & security purpose, user responsibility, and warranty disclaimer.",
  alternates: {
    canonical: "https://filmsnap-pro.netlify.app/legal",
  },
};

export default function LegalPage() {
  return (
    <LegalPageShell
      title="Legal & DMCA"
      subtitle="Disclaimer, copyright notice, and terms of use"
      icon={<Scale className="h-10 w-10 text-amber-500" strokeWidth={1.5} />}
    >
      <div className="space-y-8">
        <Section title="Content Notice">
          <Body>
            FilmSnaps does <Bold>not</Bold> host, store, upload, or manage any
            video content, files, or media. All content accessed through this
            application is hosted by third-party services that are not
            affiliated with us.
          </Body>
        </Section>

        <Section title="No Affiliation">
          <Body>
            We do not own, operate, or have any access to the servers that host
            the content you stream or download through this app. Any legal
            concerns regarding specific content must be directed to the actual
            content hosters and uploaders.
          </Body>
        </Section>

        <Section title="Educational & Security Purpose">
          <Body>
            This project is created for <Bold>educational purposes only</Bold>.
            It demonstrates open-source development, legal ad-blocking for user
            privacy, and secure media streaming.
          </Body>
        </Section>

        <Section title="User Responsibility">
          <Body>As a user, you are responsible for:</Body>
          <Bullet text="Ensuring your use complies with local laws" />
          <Bullet text="Using the app only for content you have the legal right to access" />
          <Bullet text="Not redistributing content for commercial purposes" />
        </Section>

        <Section title="No Warranty">
          <Body>
            This software is provided &quot;as is&quot; without warranty of any
            kind. The developers and contributors are not responsible for any
            damages or legal issues that may arise from the use of this
            application.
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
