import { SkeletonPlayer } from "@/components/SkeletonLoader";

export default function Loading() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center px-4">
      <div className="w-full max-w-6xl">
        <SkeletonPlayer />
      </div>
    </div>
  );
}
