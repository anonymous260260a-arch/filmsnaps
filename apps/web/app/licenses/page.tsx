import { FileText } from "lucide-react";
import Link from "next/link";
import { LegalPageShell } from "@/components/legal/LegalPageShell";
import { Section, Body, Bold } from "@/components/legal/LegalPrimitives";

export const metadata = {
  title: "Third-party licences",
  description:
    "Licences for the third-party components FilmSnaps redistributes: libmpv, the Geist fonts and their full licence texts.",
  alternates: {
    canonical: "https://filmsnap-pro.netlify.app/licenses",
  },
};

function LicenceLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      className="text-primary underline-offset-2 hover:underline"
      target="_blank"
      rel="noreferrer"
    >
      {children}
    </a>
  );
}

export default function LicensesPage() {
  return (
    <LegalPageShell
      title="Third-party licences"
      subtitle="Components FilmSnaps redistributes, and the terms they ship under."
      icon={<FileText className="h-10 w-10 text-primary" strokeWidth={1.5} />}
    >
      <Section title="libmpv (playback engine)">
        <Body>
          Video plays through <Bold>libmpv</Bold>, the library form of{" "}
          <LicenceLink href="https://mpv.io">mpv</LicenceLink>, version 0.42.0.
          FilmSnaps ships the official LGPL build published on the{" "}
          <LicenceLink href="https://github.com/mpv-player/mpv/releases/tag/v0.42.0">
            mpv v0.42.0 release page
          </LicenceLink>
          , unmodified. It is licensed under the{" "}
          <Bold>GNU Lesser General Public License, version 2.1 or later</Bold>,
          with FFmpeg linked under LGPL version 3.
        </Body>
        <Body>
          The library is loaded at runtime from <code>mpv/libmpv-2.dll</code>{" "}
          next to the app, so you can replace it with your own build of libmpv
          and the app will use it. The desktop app also honours the{" "}
          <code>MPV_LIBMPV_DLL</code> environment variable.
        </Body>
        <Body>
          Full texts:{" "}
          <LicenceLink href="/licenses/LICENSE.LGPL-2.1.txt">
            LGPL 2.1
          </LicenceLink>
          ,{" "}
          <LicenceLink href="/licenses/LICENSE.LGPL-3.0.txt">
            LGPL 3.0
          </LicenceLink>
          ,{" "}
          <LicenceLink href="/licenses/LICENSE.GPL-3.0.txt">
            GPL 3.0
          </LicenceLink>
          . Corresponding source:{" "}
          <LicenceLink href="https://github.com/mpv-player/mpv/tree/v0.42.0">
            mpv 0.42.0
          </LicenceLink>{" "}
          and{" "}
          <LicenceLink href="https://ffmpeg.org/download.html">
            FFmpeg
          </LicenceLink>
          .
        </Body>
      </Section>

      <Section title="Geist and Geist Mono">
        <Body>
          The in-video control bar, the subtitle overlays and the app interface
          use <Bold>Geist</Bold> and <Bold>Geist Mono</Bold> by Vercel, licensed
          under the <Bold>SIL Open Font License, version 1.1</Bold>.
        </Body>
        <Body>
          Full text:{" "}
          <LicenceLink href="/licenses/LICENSE-GEIST-OFL-1.1.txt">
            SIL Open Font License 1.1
          </LicenceLink>
          . Source:{" "}
          <LicenceLink href="https://github.com/vercel/geist-font">
            vercel/geist-font
          </LicenceLink>
          .
        </Body>
      </Section>

      <Section title="Where the files live">
        <Body>
          The desktop installer places every licence text in{" "}
          <code>mpv/licenses/</code> inside the install folder, next to{" "}
          <code>THIRD_PARTY_NOTICES.md</code>. The rest of the app is released
          under the GPL-3.0; see the{" "}
          <Link
            href="/legal"
            className="text-primary underline-offset-2 hover:underline"
          >
            Legal &amp; DMCA
          </Link>{" "}
          page.
        </Body>
      </Section>
    </LegalPageShell>
  );
}
