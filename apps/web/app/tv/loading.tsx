import { SkeletonGrid } from "@/components/SkeletonLoader";

export default function Loading() {
  return (
    <div className="min-h-screen bg-[#070708] px-4 sm:px-6 lg:px-8 pt-24 pb-12">
      <SkeletonGrid count={12} />
    </div>
  );
}
