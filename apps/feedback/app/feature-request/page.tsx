"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FeatureRequestForm } from "@/components/FeatureRequestForm";
import { CloudflareAdapter } from "@/lib/cloudflare-adapter";

export default function FeatureRequestPage() {
  const router = useRouter();
  const [storage, setStorage] = useState<CloudflareAdapter | null>(null);

  useEffect(() => {
    setStorage(new CloudflareAdapter());
  }, []);

  if (!storage) {
    return (
      <main className="min-h-screen">
        <div className="max-w-3xl mx-auto px-4 py-8" />
      </main>
    );
  }

  return (
    <main className="min-h-screen">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <FeatureRequestForm onBack={() => router.push("/")} storage={storage} />
      </div>
    </main>
  );
}
