"use client";

import { AlertTriangle, ThumbsUp, ExternalLink } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { DuplicateResult } from "@/lib/search";

interface DuplicateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  duplicates: DuplicateResult[];
  onContinue: () => void;
  onViewExisting: (id: string) => void;
}

export function DuplicateDialog({
  open,
  onOpenChange,
  duplicates,
  onContinue,
  onViewExisting,
}: DuplicateDialogProps) {
  if (duplicates.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-yellow-500" />
            Possible duplicate found
          </DialogTitle>
          <DialogDescription>
            We found similar {duplicates.length > 1 ? "reports" : "a report"}{" "}
            that might match what you are describing.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {duplicates.map((dup) => (
            <div
              key={dup.id}
              className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{dup.title}</p>
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <ThumbsUp className="w-3 h-3" />
                    {dup.existing.upvotes}
                  </span>
                  <span>
                    Match: {Math.round((1 - (dup.score ?? 0)) * 100)}%
                  </span>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0"
                onClick={() => onViewExisting(dup.id)}
              >
                <ExternalLink className="w-3 h-3 mr-1" />
                View
              </Button>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="default" onClick={onContinue}>
            Continue anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
