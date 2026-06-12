'use client';

import * as React from 'react';
import {
  Filter,
  Search,
  RotateCcw,
  Star,
  Calendar,
  Languages,
  SortAsc,
} from 'lucide-react';
import { GlassButton } from '@/components/ui/glass-button';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerFooter,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface Genre {
  id: number;
  name: string;
}

interface FilterProps {
  genres: Genre[];
  selectedGenres: number[];
  onGenreToggle: (id: number) => void;
  sortBy: string;
  onSortChange: (value: string) => void;
  yearRange: [number, number];
  onYearRangeChange: (range: [number, number]) => void;
  ratingRange: [number, number];
  onRatingRangeChange: (range: [number, number]) => void;
  language: string;
  onLanguageChange: (value: string) => void;
  onReset: () => void;
  onApply: () => void;
}

export function MediaFilter({
  genres,
  selectedGenres,
  onGenreToggle,
  sortBy,
  onSortChange,
  yearRange,
  onYearRangeChange,
  ratingRange,
  onRatingRangeChange,
  language,
  onLanguageChange,
  onReset,
  onApply,
}: FilterProps) {
  const [genreSearch, setGenreSearch] = React.useState('');
  const [isOpen, setIsOpen] = React.useState(false);

  const filteredGenres = genres.filter((g) =>
    g.name.toLowerCase().includes(genreSearch.toLowerCase())
  );

  const activeFilterCount =
    (selectedGenres.length > 0 ? 1 : 0) +
    (sortBy !== 'popularity.desc' ? 1 : 0) +
    (yearRange[0] !== 1900 || yearRange[1] !== new Date().getFullYear()
      ? 1
      : 0) +
    (ratingRange[0] !== 0 || ratingRange[1] !== 10 ? 1 : 0) +
    (language !== '' ? 1 : 0);

  return (
    <Drawer open={isOpen} onOpenChange={setIsOpen}>
      <DrawerTrigger asChild>
        <GlassButton
          variant="outline"
          className="relative group overflow-hidden"
        >
          <Filter className="mr-2 h-4 w-4 transition-transform group-hover:rotate-180" />
          Filters
          {activeFilterCount > 0 && (
            <Badge
              variant="secondary"
              className="ml-2 bg-primary text-primary-foreground"
            >
              {activeFilterCount}
            </Badge>
          )}
        </GlassButton>
      </DrawerTrigger>
      <DrawerContent className="max-h-[85vh] outline-none">
        <DrawerHeader className="border-b pb-4 px-6">
          <div className="flex items-center justify-between">
            <DrawerTitle className="text-2xl font-bold tracking-tight">
              Refine Collection
            </DrawerTitle>
            <GlassButton
              variant="ghost"
              size="icon"
              onClick={onReset}
              title="Reset Filters"
            >
              <RotateCcw className="h-4 w-4" />
            </GlassButton>
          </div>
        </DrawerHeader>

        <ScrollArea className="flex-1 px-6 py-4">
          <div className="space-y-8 pb-8">
            {/* Sort Section */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                <SortAsc className="h-4 w-4" />
                <span>SORTING</span>
              </div>
              <Select value={sortBy} onValueChange={onSortChange}>
                <SelectTrigger className="w-full bg-secondary/30 border-none h-11 focus:ring-1">
                  <SelectValue placeholder="Sort by..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="popularity.desc">
                    Trending Popularity
                  </SelectItem>
                  <SelectItem value="vote_average.desc">
                    Critics' Top Rated
                  </SelectItem>
                  <SelectItem value="primary_release_date.desc">
                    Latest Releases
                  </SelectItem>
                  <SelectItem value="primary_release_date.asc">
                    Vintage Collection
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Separator className="opacity-50" />

            {/* Genres Section */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                  <Search className="h-4 w-4" />
                  <span>GENRES</span>
                </div>
                {selectedGenres.length > 0 && (
                  <span className="text-xs text-primary font-medium">
                    {selectedGenres.length} selected
                  </span>
                )}
              </div>

              <Input
                placeholder="Find a genre..."
                value={genreSearch}
                onChange={(e) => setGenreSearch(e.target.value)}
                className="bg-secondary/30 border-none h-11 focus:ring-1"
              />

              <div className="flex flex-wrap gap-2 max-h-[200px] overflow-y-auto pr-2 custom-scrollbar mb-4">
                {filteredGenres.map((g) => (
                  <Badge
                    key={g.id}
                    variant={
                      selectedGenres.includes(g.id) ? 'default' : 'outline'
                    }
                    className={cn(
                      'cursor-pointer py-1.5 px-3 transition-all duration-200',
                      selectedGenres.includes(g.id)
                        ? 'bg-primary hover:bg-primary/90'
                        : 'bg-secondary/20 hover:bg-secondary/40 border-transparent'
                    )}
                    onClick={() => onGenreToggle(g.id)}
                  >
                    {g.name}
                  </Badge>
                ))}
              </div>
            </div>

            <Separator className="opacity-50 mt-5" />

            {/* Sliders Section */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-2">
              {/* Year Range */}
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                    <Calendar className="h-4 w-4" />
                    <span>RELEASE YEAR</span>
                  </div>
                  <span className="text-sm font-mono">
                    {yearRange[0]} — {yearRange[1]}
                  </span>
                </div>
                <Slider
                  min={1900}
                  max={new Date().getFullYear()}
                  step={1}
                  value={yearRange}
                  onValueChange={(val) =>
                    onYearRangeChange(val as [number, number])
                  }
                  className="py-4"
                />
              </div>

              {/* Rating Range */}
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                    <Star className="h-4 w-4" />
                    <span>TMDB RATING</span>
                  </div>
                  <span className="text-sm font-mono">
                    {ratingRange[0].toFixed(1)} — {ratingRange[1].toFixed(1)}
                  </span>
                </div>
                <Slider
                  min={0}
                  max={10}
                  step={0.1}
                  value={ratingRange}
                  onValueChange={(val) =>
                    onRatingRangeChange(val as [number, number])
                  }
                  className="py-4"
                />
              </div>
            </div>

            <Separator className="opacity-50" />

            {/* Language Section */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                <Languages className="h-4 w-4" />
                <span>ORIGINAL LANGUAGE</span>
              </div>
              <Select value={language} onValueChange={onLanguageChange}>
                <SelectTrigger className="w-full bg-secondary/30 border-none h-11 focus:ring-1">
                  <SelectValue placeholder="All Languages" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value=" ">All Languages</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="ko">Korean</SelectItem>
                  <SelectItem value="ja">Japanese</SelectItem>
                  <SelectItem value="hi">Hindi</SelectItem>
                  <SelectItem value="es">Spanish</SelectItem>
                  <SelectItem value="fr">French</SelectItem>
                  <SelectItem value="de">German</SelectItem>
                  <SelectItem value="it">Italian</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </ScrollArea>

        <DrawerFooter className="border-t pt-4 px-6 flex flex-row gap-3">
          <GlassButton
            variant="outline"
            className="flex-1"
            onClick={() => setIsOpen(false)}
          >
            Cancel
          </GlassButton>
          <GlassButton
            className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground font-bold shadow-lg shadow-primary/20"
            onClick={() => {
              onApply();
              setIsOpen(false);
            }}
          >
            Apply Changes
          </GlassButton>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
