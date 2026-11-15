import { Suspense } from "react";
import NxshaPage from "./NxshaPage";

function NxshaSpinner() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<NxshaSpinner />}>
      <NxshaPage />
    </Suspense>
  );
}
