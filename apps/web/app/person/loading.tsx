import { SkeletonPerson } from "@/components/SkeletonLoader";

// The fixed header comes from person/layout.tsx (it wraps loading.tsx the
// same way it wraps the page), so the skeleton only renders the content
// column — same contract as the loaded page.
export default function Loading() {
  return <SkeletonPerson />;
}
