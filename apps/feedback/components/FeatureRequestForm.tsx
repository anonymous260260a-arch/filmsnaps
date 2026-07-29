"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Send,
  Loader2,
  Lightbulb,
  AlertTriangle,
  WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { DuplicateDialog } from "@/components/DuplicateDialog";
import type { StorageProvider } from "@/lib/storage";
import { findDuplicates } from "@/lib/search";
import {
  MIN_TITLE_LENGTH,
  MIN_DESCRIPTION_LENGTH,
  SUBMISSION_COOLDOWN_MS,
} from "@/lib/constants";
import {
  checkSubmissionCooldown,
  setLastSubmit,
  saveDraft,
  loadDraft,
  removeDraft,
} from "@/lib/client-utils";
import { getPendingCount } from "@/lib/offline-queue";

const featureSchema = z.object({
  title: z
    .string()
    .min(
      MIN_TITLE_LENGTH,
      `Title must be at least ${MIN_TITLE_LENGTH} characters`,
    ),
  description: z
    .string()
    .min(
      MIN_DESCRIPTION_LENGTH,
      `Description must be at least ${MIN_DESCRIPTION_LENGTH} characters`,
    ),
  problem: z.string().min(10, "Please describe the problem you are facing"),
  suggestedSolution: z
    .string()
    .min(10, "Please describe your suggested solution"),
  alternativeSolutions: z.string().optional(),
  businessValue: z
    .string()
    .min(10, "Please describe the value this would bring"),
});

type FeatureFormData = z.infer<typeof featureSchema>;

interface FeatureRequestFormProps {
  onBack: () => void;
  storage: StorageProvider;
}

const DRAFT_KEY = "@filmsnaps/feedback/draft/feature";

export function FeatureRequestForm({
  onBack,
  storage,
}: FeatureRequestFormProps) {
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [duplicates, setDuplicates] = useState<any[]>([]);
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [isOffline, setIsOffline] = useState(
    typeof navigator !== "undefined" ? !navigator.onLine : false,
  );
  const [pendingCount, setPendingCount] = useState(0);

  // Track online/offline status
  useEffect(() => {
    const goOnline = () => {
      setIsOffline(false);
      setPendingCount(getPendingCount());
    };
    const goOffline = () => {
      setIsOffline(true);
    };
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const form = useForm<FeatureFormData>({
    resolver: zodResolver(featureSchema),
    defaultValues: {
      title: "",
      description: "",
      problem: "",
      suggestedSolution: "",
      alternativeSolutions: "",
      businessValue: "",
    },
  });

  // Auto-save draft
  const watchedValues = form.watch();
  useEffect(() => {
    saveDraft(DRAFT_KEY, watchedValues);
  }, [watchedValues]);

  // Restore draft
  useEffect(() => {
    const draft = loadDraft<FeatureFormData>(DRAFT_KEY);
    if (draft) {
      form.reset(draft);
    }
  }, []);

  // Check cooldown
  useEffect(() => {
    const remaining = checkSubmissionCooldown(SUBMISSION_COOLDOWN_MS);
    if (remaining > 0) setCooldown(remaining);
  }, []);

  // Check pending offline queue count
  useEffect(() => {
    setPendingCount(getPendingCount());
    const interval = setInterval(
      () => setPendingCount(getPendingCount()),
      5000,
    );
    return () => clearInterval(interval);
  }, []);

  const checkDuplicates = useCallback(
    async (title: string) => {
      if (title.length < 4) return;
      const features = await storage.getFeatureRequests();
      const results = findDuplicates(title, features);
      if (results.length > 0) {
        setDuplicates(results);
        setShowDuplicateDialog(true);
      }
    },
    [storage],
  );

  const doSubmit = async (data: FeatureFormData) => {
    setSubmitting(true);
    try {
      const remaining = checkSubmissionCooldown(SUBMISSION_COOLDOWN_MS);
      if (remaining > 0) {
        toast.error(
          `Please wait ${Math.ceil(remaining / 1000)}s before submitting again.`,
        );
        setSubmitting(false);
        return;
      }

      await storage.createFeatureRequest({
        title: data.title,
        description: data.description,
        problem: data.problem,
        suggestedSolution: data.suggestedSolution,
        alternativeSolutions: data.alternativeSolutions || "",
        businessValue: data.businessValue,
        status: "open",
        type: "feature",
      });

      setLastSubmit();
      removeDraft(DRAFT_KEY);
      setSubmitted(true);

      if (isOffline) {
        toast.success("Saved offline — will submit when connected.");
      } else {
        toast.success("Feature request submitted successfully!");
      }
    } catch (err: any) {
      toast.error(
        err?.message || "Failed to submit feature request. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmit = async (data: FeatureFormData) => {
    // Check duplicates before submit
    const features = await storage.getFeatureRequests();
    const dups = findDuplicates(data.title, features);
    if (dups.length > 0) {
      setDuplicates(dups);
      setShowDuplicateDialog(true);
      return;
    }
    await doSubmit(data);
  };

  if (submitted) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-16 h-16 rounded-full bg-blue-500/15 flex items-center justify-center mb-4">
          <Lightbulb className="w-8 h-8 text-blue-500" />
        </div>
        <h2 className="text-xl font-semibold mb-2">
          {isOffline ? "Saved Offline" : "Feature Request Submitted"}
        </h2>
        <p className="text-muted-foreground max-w-md mb-6">
          {isOffline
            ? "Your request has been saved locally and will be submitted automatically when you are back online."
            : "Thank you for your suggestion! Our team will review it and consider it for the roadmap."}
        </p>
        {pendingCount > 0 && (
          <p className="text-sm text-amber-500 mb-4">
            {pendingCount} pending submission{pendingCount !== 1 ? "s" : ""}{" "}
            waiting in queue.
          </p>
        )}
        <div className="flex gap-3">
          <Button variant="outline" onClick={onBack}>
            Back to Home
          </Button>
          <Button
            onClick={() => {
              setSubmitted(false);
              form.reset();
            }}
          >
            Submit Another
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-xl font-semibold">Request a Feature</h1>
          <p className="text-sm text-muted-foreground">
            Share your idea for improving FilmSnaps.
          </p>
        </div>
      </div>

      {/* Offline banner */}
      {isOffline && (
        <div className="flex items-center gap-2 p-3 mb-4 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-sm">
          <WifiOff className="w-4 h-4 shrink-0" />
          <span>
            You are offline. Your submission will be saved and sent when you
            reconnect.
          </span>
        </div>
      )}

      {/* Pending queue notice */}
      {pendingCount > 0 && !isOffline && (
        <div className="flex items-center gap-2 p-3 mb-4 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            {pendingCount} pending submission{pendingCount !== 1 ? "s" : ""}{" "}
            syncing...
          </span>
        </div>
      )}

      <DuplicateDialog
        open={showDuplicateDialog}
        onOpenChange={setShowDuplicateDialog}
        duplicates={duplicates}
        onContinue={() => {
          setShowDuplicateDialog(false);
          doSubmit(form.getValues());
        }}
        onViewExisting={() => {
          setShowDuplicateDialog(false);
          toast.info("Viewing existing requests coming soon");
        }}
      />

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Honeypot */}
        <div className="absolute -left-[9999px]" aria-hidden="true">
          <label htmlFor="website-feat">Website</label>
          <input
            id="website-feat"
            name="website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
          />
        </div>

        {/* Turnstile container (invisible) */}
        <div id="turnstile-container-feature" className="flex justify-center" />

        {/* Title */}
        <div className="space-y-2">
          <Label htmlFor="title">
            Title <span className="text-destructive">*</span>
          </Label>
          <Input
            id="title"
            placeholder="A short, clear title for your feature request"
            {...form.register("title")}
            onBlur={(e) => {
              form.trigger("title");
              checkDuplicates(e.target.value);
            }}
          />
          {form.formState.errors.title && (
            <p className="text-sm text-destructive">
              {form.formState.errors.title.message}
            </p>
          )}
        </div>

        {/* Problem */}
        <div className="space-y-2">
          <Label htmlFor="problem">
            Problem <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="problem"
            placeholder="What problem does this feature solve?"
            rows={3}
            {...form.register("problem")}
          />
          {form.formState.errors.problem && (
            <p className="text-sm text-destructive">
              {form.formState.errors.problem.message}
            </p>
          )}
        </div>

        {/* Description */}
        <div className="space-y-2">
          <Label htmlFor="description">
            Description <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="description"
            placeholder="Detailed description of the feature"
            rows={4}
            {...form.register("description")}
          />
          {form.formState.errors.description && (
            <p className="text-sm text-destructive">
              {form.formState.errors.description.message}
            </p>
          )}
        </div>

        {/* Suggested Solution */}
        <div className="space-y-2">
          <Label htmlFor="suggestedSolution">
            Suggested Solution <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="suggestedSolution"
            placeholder="How do you envision this feature working?"
            rows={3}
            {...form.register("suggestedSolution")}
          />
          {form.formState.errors.suggestedSolution && (
            <p className="text-sm text-destructive">
              {form.formState.errors.suggestedSolution.message}
            </p>
          )}
        </div>

        {/* Alternatives */}
        <div className="space-y-2">
          <Label htmlFor="alternativeSolutions">
            Alternative Solutions (optional)
          </Label>
          <Textarea
            id="alternativeSolutions"
            placeholder="Any alternative approaches you have considered?"
            rows={2}
            {...form.register("alternativeSolutions")}
          />
        </div>

        {/* Business Value */}
        <div className="space-y-2">
          <Label htmlFor="businessValue">
            Value <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="businessValue"
            placeholder="How would this feature benefit users or the app?"
            rows={2}
            {...form.register("businessValue")}
          />
          {form.formState.errors.businessValue && (
            <p className="text-sm text-destructive">
              {form.formState.errors.businessValue.message}
            </p>
          )}
        </div>

        {/* Submit */}
        <Button
          type="submit"
          className="w-full"
          disabled={submitting || cooldown > 0}
        >
          {submitting ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Submitting...
            </>
          ) : cooldown > 0 ? (
            `Wait ${Math.ceil(cooldown / 1000)}s`
          ) : (
            <>
              <Send className="w-4 h-4 mr-2" />
              {isOffline ? "Save Offline" : "Submit Feature Request"}
            </>
          )}
        </Button>
      </form>
    </div>
  );
}
