"use client";

import { useState, useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { SearchBar } from "@/components/SearchBar";
import { CloudflareAdapter } from "@/lib/cloudflare-adapter";
import { searchFaq } from "@/lib/search";
import type { FaqCategory } from "@/lib/types";

const storage = new CloudflareAdapter();

export default function FaqPage() {
  const [categories, setCategories] = useState<FaqCategory[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    storage.getFaq().then(setCategories);
  }, []);

  const filtered = searchFaq(categories, query);

  return (
    <main className="min-h-screen">
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <Link href="/">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-semibold">
              Frequently Asked Questions
            </h1>
            <p className="text-sm text-muted-foreground">
              Find answers to common questions about FilmSnaps.
            </p>
          </div>
        </div>

        {/* Search */}
        <div className="my-6">
          <SearchBar
            value={query}
            onChange={setQuery}
            placeholder="Search FAQ..."
          />
        </div>

        {/* Categories */}
        {filtered.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">
              {query ? "No matching questions found." : "No FAQ available yet."}
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {filtered.map((category) => (
              <section key={category.id}>
                <h2 className="font-semibold text-base mb-3 flex items-center gap-2">
                  <span className="w-1 h-4 bg-primary rounded-full" />
                  {category.name}
                </h2>
                <Accordion type="multiple" className="rounded-lg border">
                  {category.items.map((item, idx) => (
                    <AccordionItem key={idx} value={`${category.id}-${idx}`}>
                      <AccordionTrigger className="px-4 text-sm font-medium text-left hover:no-underline">
                        {item.question}
                      </AccordionTrigger>
                      <AccordionContent className="px-4 text-sm text-muted-foreground leading-relaxed">
                        {item.answer}
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
