/**
 * legal-sections — accordion sections for the Legal & DMCA acceptance gate.
 *
 * Ported verbatim from the mobile app's first-launch LegalGate
 * (apps/mobile/components/LegalGate.tsx) so the web + desktop gates present
 * the exact same five sections as the mobile app.
 */

export interface LegalSection {
  key: string;
  title: string;
  body: React.ReactNode;
}

export const LEGAL_GATE_SECTIONS: LegalSection[] = [
  {
    key: "content",
    title: "Content Notice",
    body: (
      <p className="text-sm leading-6 text-zinc-300">
        FilmSnaps does{" "}
        <strong className="font-semibold text-zinc-100">not</strong> host,
        store, upload, or manage any video content, files, or media. All content
        accessed through this application is hosted by third-party services that
        are not affiliated with us.
      </p>
    ),
  },
  {
    key: "affiliation",
    title: "No Affiliation",
    body: (
      <p className="text-sm leading-6 text-zinc-300">
        We do not own, operate, or have any access to the servers that host the
        content you stream or download through this app. We do not control what
        content is available, how it is stored, or who has access to it. Any
        legal concerns regarding specific content must be directed to the actual
        content hosters and uploaders.
      </p>
    ),
  },
  {
    key: "about",
    title: "About This Project",
    body: (
      <p className="text-sm leading-6 text-zinc-300">
        FilmSnaps is an independent project and is not a commercial streaming
        service. It demonstrates open-source software development and modern
        mobile application architecture.
      </p>
    ),
  },
  {
    key: "responsibility",
    title: "User Responsibility",
    body: (
      <div>
        <p className="text-sm leading-6 text-zinc-300">
          As a user of this application, you are responsible for:
        </p>
        <ul className="mt-2 space-y-2">
          {[
            "Ensuring your use complies with local laws in your jurisdiction",
            "Using the app only for accessing content you have the legal right to access",
            "Not redistributing downloaded content or using it for commercial purposes",
          ].map((item) => (
            <li key={item} className="flex items-start gap-2.5">
              <span className="mt-1.5 text-[11px] leading-none text-[#D4A237]">
                ■
              </span>
              <span className="text-sm leading-5 text-zinc-300">{item}</span>
            </li>
          ))}
        </ul>
      </div>
    ),
  },
  {
    key: "warranty",
    title: "No Warranty",
    body: (
      <p className="text-sm leading-6 text-zinc-300">
        This software is provided &quot;as is&quot; without warranty of any
        kind. The developers and contributors are not responsible for any
        damages or legal issues that may arise from the use of this application.
      </p>
    ),
  },
];
