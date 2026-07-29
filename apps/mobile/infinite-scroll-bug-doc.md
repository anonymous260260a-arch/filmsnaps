# Infinite Scroll Duplicate Bug — Root Cause & Fix

## Summary

**Discover/filter mode** (movie, TV, all tabs) shows duplicate results on infinite scroll. **Search mode** works fine. Both use the same `appendUnique` dedup-by-ID function.

## Root Cause

### Bug 1: Race condition in `appendUnique` — same-render-cycle double-fire

The discover mode effect depends on **both** `movieFilterResult.data` and `tvFilterResult.data`:

```ts
useEffect(() => {
  if (mediaTypeFilter === "movie") {
    const raw = movieFilterResult.data?.results;
    appendUnique(raw.map(r => ({ ...r, _mediaType: "movie" })));
  }
  // ...
}, [movieFilterResult.data, tvFilterResult.data, ...]);
```

When `page` increments, **both** queries start loading for the new page. If they resolve in the **same render cycle** (common with fast network), the effect fires **twice** (once when movie data arrives, once when TV data arrives).

Both calls to `appendUnique` run before React commits any state update. React 18 batches state updates but **function updaters from the same render cycle all see the same base state**:

```
1. Movie resolves → appendUnique([movieP2])
   setAllResults(prev => {                     // prev = [page1Items]
     existingIds = {id1, id2, id3, ...}
     fresh = [movieP2Items]                    // none in existingIds
     return [...page1, ...movieP2]
   })

2. TV resolves → appendUnique([movieP2]) ← SAME data, SAME render cycle
   setAllResults(prev => {                     // prev = [page1Items] ← NOT [page1, movieP2]!
     existingIds = {id1, id2, id3, ...}       // movieP2 IDs NOT yet in set
     fresh = [movieP2Items]                    // passes through!
     return [...page1, ...movieP2]
   })

3. React applies both: [...page1, ...movieP2, ...page1, ...movieP2]
```

The `(prev) => ...` callback always sees the committed state, not the pending one.

### Bug 2: "all" mode stale-data race

In "all" mode, movie page 2 can resolve before TV page 2. The guard `if (!movieData || !tvData) return` passes because `tvData` still holds **page 1's truthy data**. Page 2 movies are merged with page 1 TV data. When TV page 2 arrives later, it's appended as fresh data alongside movies that are now duplicated.

## Why Search Mode Works

Search mode has a SINGLE dep (`searchResult.data`) and a SINGLE source. No race possible — one data change, one effect fire.

## Fix

### Fix 1: Ref-based synchronous ID dedup

Replace state-based dedup (which sees stale `prev` across same-render-cycle calls) with a ref updated synchronously:

```ts
// NEW: synchronous ID tracking — survives same-render-cycle races
const seenIdsRef = useRef<Set<number>>(new Set());

const appendUnique = useCallback((incoming: any[]) => {
  const fresh = incoming.filter((i: any) => {
    if (seenIdsRef.current.has(i.id)) return false;
    seenIdsRef.current.add(i.id);
    return true;
  });
  if (fresh.length === 0) return;
  setAllResults((prev) => {
    const next = [...prev, ...fresh];
    allResultsRef.current = next;
    return next;
  });
}, []);
```

### Fix 2: Clear seen IDs on reset

```ts
const resetPagination = useCallback(() => {
  setPage(1);
  setAllResults([]);
  allResultsRef.current = [];
  seenIdsRef.current = new Set(); // ← NEW
}, []);
```

### Fix 3: "all" mode both-not-fetching guard

Add an `isFetching` check so "all" mode only merges when BOTH queries have finished:

```ts
if (mediaTypeFilter === "all") {
  const movieData = movieFilterResult.data?.results;
  const tvData = tvFilterResult.data?.results;
  if (!movieData || !tvData) return;
  if (movieFilterResult.isFetching || tvFilterResult.isFetching) return; // ← NEW
  // ... merge
}
```

## Implementation

Replace the current `appendUnique` and effects in `apps/mobile/app/(tabs)/search.tsx` with:

### 1. Add the ref (replace line 75)

```ts
const [allResults, setAllResults] = useState<any[]>([]);
const allResultsRef = useRef<any[]>([]);
const seenIdsRef = useRef<Set<number>>(new Set()); // ← NEW
```

### 2. Replace `appendUnique` (lines 108-121)

```ts
const appendUnique = useCallback((incoming: any[]) => {
  const fresh = incoming.filter((i: any) => {
    if (seenIdsRef.current.has(i.id)) return false;
    seenIdsRef.current.add(i.id);
    return true;
  });
  if (fresh.length === 0) return;
  setAllResults((prev) => {
    const next = [...prev, ...fresh];
    allResultsRef.current = next;
    return next;
  });
}, []);
```

### 3. Replace the discover effect (lines 133-167)

```ts
useEffect(() => {
  if (isSearching) return;

  if (mediaTypeFilter === "all") {
    const movieData = movieFilterResult.data?.results;
    const tvData = tvFilterResult.data?.results;
    if (!movieData || !tvData) return;
    if (movieFilterResult.isFetching || tvFilterResult.isFetching) return;
    const merged: any[] = [];
    const max = Math.max(movieData.length, tvData.length);
    for (let i = 0; i < max; i++) {
      if (i < movieData.length)
        merged.push({ ...movieData[i], _mediaType: "movie" });
      if (i < tvData.length) merged.push({ ...tvData[i], _mediaType: "tv" });
    }
    appendUnique(merged);
  } else {
    const raw =
      mediaTypeFilter === "movie"
        ? movieFilterResult.data?.results
        : tvFilterResult.data?.results;
    if (!raw?.length) return;
    const tagged = raw.map((r: any) => ({
      ...r,
      _mediaType: mediaTypeFilter,
    }));
    appendUnique(tagged);
  }
}, [
  movieFilterResult.data,
  tvFilterResult.data,
  isSearching,
  mediaTypeFilter,
  appendUnique,
]);
```

### 4. Update `resetPagination` (line 190)

```ts
const resetPagination = useCallback(() => {
  setPage(1);
  setAllResults([]);
  allResultsRef.current = [];
  seenIdsRef.current = new Set();
}, []);
```

### 5. Same fix for `list/[category].tsx`

Replace the page-based set with an ID-based ref:

```ts
const [allResults, setAllResults] = useState<any[]>([]);
const seenIdsRef = useRef<Set<number>>(new Set());
```

```ts
React.useEffect(() => {
  if (data?.results) {
    if (page === 1) {
      seenIdsRef.current = new Set();
      setAllResults(data.results);
      data.results.forEach((r: any) => seenIdsRef.current.add(r.id));
    } else {
      const fresh = data.results.filter((r: any) => {
        if (seenIdsRef.current.has(r.id)) return false;
        seenIdsRef.current.add(r.id);
        return true;
      });
      if (fresh.length > 0) {
        setAllResults((prev) => [...prev, ...fresh]);
      }
    }
  }
}, [data, page]);
```
