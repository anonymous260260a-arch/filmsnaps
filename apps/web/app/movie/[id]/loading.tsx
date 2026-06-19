import { Loader } from '@/components/Loader';

export default function Loading() {
  return (
    <div className="min-h-screen pt-16 flex items-center justify-center">
      <Loader />
    </div>
  );
}
