import { Suspense } from "react";
import FalixPage from "./FalixPage";

function FalixSpinner() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<FalixSpinner />}>
      <FalixPage />
    </Suspense>
  );
}
