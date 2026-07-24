// app/tv/[id]/page.tsx
import { tmdbTvFull } from '@/lib/tmdb.server';
import TVClient from './TVClient';

export default async function TVShowPage({ params }: { params: any }) {
  const { id } = await params;

  let show;
  try {
    show = await tmdbTvFull(id);
  } catch (error) {
    console.error(error);
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg text-muted-foreground">TV show not found</div>
      </div>
    );
  }

  return <TVClient show={show} />;
}
