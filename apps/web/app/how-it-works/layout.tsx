import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "How Content Works",
  description:
    "How FilmSnaps sources content, blocks ads at the network and page level, and protects your privacy.",
};

export default function HowItWorksLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
