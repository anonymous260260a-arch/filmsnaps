'use client';

import { useEffect, useState, useRef } from 'react';

export function VideoPlayer({ videoKey, title }) {
  const [isLoaded, setIsLoaded] = useState(false);
  const iframeRef = useRef(null);

  useEffect(() => {
    // Defer loading of the iframe to reduce main thread blocking
    const timer = setTimeout(() => {
      setIsLoaded(true);
    }, 100);

    return () => clearTimeout(timer);
  }, []);

  if (!videoKey) return null;

  return (
    <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden">
      {isLoaded && (
        <iframe
          ref={iframeRef}
          src={`https://www.youtube.com/embed/${videoKey}?autoplay=0&modestbranding=1&rel=0`}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="absolute inset-0 w-full h-full"
          loading="lazy"
        />
      )}
    </div>
  );
}