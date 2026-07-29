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
  AlertTriangle,
  Bug,
  WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DuplicateDialog } from "@/components/DuplicateDialog";
import type { StorageProvider } from "@/lib/storage";
import { findDuplicates } from "@/lib/search";
import {
  MIN_TITLE_LENGTH,
  MIN_DESCRIPTION_LENGTH,
  SUBMISSION_COOLDOWN_MS,
  SEVERITY_LABELS,
} from "@/lib/constants";
import {
  checkSubmissionCooldown,
  setLastSubmit,
  saveDraft,
  loadDraft,
  removeDraft,
} from "@/lib/client-utils";
import { getPendingCount } from "@/lib/offline-queue";
import type { BugReport, Severity } from "@/lib/types";

const bugSchema = z.object({
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
  expectedBehavior: z.string().min(10, "Please describe what you expected"),
  actualBehavior: z.string().min(10, "Please describe what actually happened"),
  stepsToReproduce: z
    .string()
    .min(10, "Please describe the steps to reproduce"),
  severity: z.string(),
  deviceInfo: z.string().optional(),
  appVersion: z.string().optional(),
  platform: z.string().optional(),
  currentPage: z.string().optional(),
});

type BugFormData = z.infer<typeof bugSchema>;

interface BugReportFormProps {
  onBack: () => void;
  storage: StorageProvider;
}

const DRAFT_KEY = "@filmsnaps/feedback/draft/bug";

export function BugReportForm({ onBack, storage }: BugReportFormProps) {
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

  const form = useForm<BugFormData>({
    resolver: zodResolver(bugSchema),
    defaultValues: {
      title: "",
      description: "",
      expectedBehavior: "",
      actualBehavior: "",
      stepsToReproduce: "",
      severity: "medium",
      deviceInfo: typeof navigator !== "undefined" ? navigator.userAgent : "",
      appVersion: "",
      platform:
        typeof navigator !== "undefined"
          ? /Mobi|Android/i.test(navigator.userAgent)
            ? "Mobile"
            : "Desktop"
          : "Desktop",
      currentPage: "",
    },
  });

  // Auto-save draft
  const watchedValues = form.watch();
  useEffect(() => {
    saveDraft(DRAFT_KEY, watchedValues);
  }, [watchedValues]);

  // Restore draft
  useEffect(() => {
    const draft = loadDraft<BugFormData>(DRAFT_KEY);
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

  // Run duplicate detection
  const checkDuplicates = useCallback(
    async (title: string) => {
      if (title.length < 4) return;
      const bugs = await storage.getBugs();
      const results = findDuplicates(title, bugs);
      if (results.length > 0) {
        setDuplicates(results);
        setShowDuplicateDialog(true);
      }
    },
    [storage],
  );

  const onSubmit = async (data: BugFormData) => {
    // Check duplicates again before submit
    const bugs = await storage.getBugs();
    const dups = findDuplicates(data.title, bugs);
    if (dups.length > 0) {
      setDuplicates(dups);
      setShowDuplicateDialog(true);
      return;
    }

    await doSubmit(data);
  };

  const doSubmit = async (data: BugFormData) => {
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

      await storage.createBug({
        title: data.title,
        description: data.description,
        expectedBehavior: data.expectedBehavior,
        actualBehavior: data.actualBehavior,
        stepsToReproduce: data.stepsToReproduce,
        severity: data.severity as Severity,
        deviceInfo: data.deviceInfo,
        appVersion: data.appVersion,
        platform: data.platform,
        currentPage: data.currentPage,
        status: "open",
        type: "bug",
      });

      setLastSubmit();
      removeDraft(DRAFT_KEY);
      setSubmitted(true);

      if (isOffline) {
        toast.success("Saved offline — will submit when connected.");
      } else {
        toast.success("Bug report submitted successfully!");
      }
    } catch (err: any) {
      toast.error(
        err?.message || "Failed to submit bug report. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-16 h-16 rounded-full bg-green-500/15 flex items-center justify-center mb-4">
          <Bug className="w-8 h-8 text-green-500" />
        </div>
        <h2 className="text-xl font-semibold mb-2">
          {isOffline ? "Saved Offline" : "Bug Report Submitted"}
        </h2>
        <p className="text-muted-foreground max-w-md mb-6">
          {isOffline
            ? "Your report has been saved locally and will be submitted automatically when you are back online."
            : "Thank you for reporting this bug. Our team will review it and update the status."}
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
            Report Another
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-xl font-semibold">Report a Bug</h1>
          <p className="text-sm text-muted-foreground">
            Help us improve by describing what went wrong.
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
        onViewExisting={(id) => {
          setShowDuplicateDialog(false);
          toast.info("Viewing existing reports coming soon");
        }}
      />

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Honeypot */}
        <div className="absolute -left-[9999px]" aria-hidden="true">
          <label htmlFor="website">Website</label>
          <input
            id="website"
            name="website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
          />
        </div>

        {/* Turnstile container (invisible) */}
        <div id="turnstile-container-bug" className="flex justify-center" />

        {/* Title */}
        <div className="space-y-2">
          <Label htmlFor="title">
            Title <span className="text-destructive">*</span>
          </Label>
          <Input
            id="title"
            placeholder="Brief summary of the bug"
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

        {/* Severity */}
        <div className="space-y-2">
          <Label htmlFor="severity">
            Severity <span className="text-destructive">*</span>
          </Label>
          <Select
            value={form.watch("severity")}
            onValueChange={(v) => form.setValue("severity", v)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select severity" />
            </SelectTrigger>
            <SelectContent>
              {(Object.entries(SEVERITY_LABELS) as [Severity, string][]).map(
                ([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </div>

        {/* Description */}
        <div className="space-y-2">
          <Label htmlFor="description">
            Description <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="description"
            placeholder="Detailed description of the bug"
            rows={4}
            {...form.register("description")}
          />
          {form.formState.errors.description && (
            <p className="text-sm text-destructive">
              {form.formState.errors.description.message}
            </p>
          )}
        </div>

        {/* Expected vs Actual */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="expectedBehavior">
              Expected Behavior <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="expectedBehavior"
              placeholder="What did you expect to happen?"
              rows={3}
              {...form.register("expectedBehavior")}
            />
            {form.formState.errors.expectedBehavior && (
              <p className="text-sm text-destructive">
                {form.formState.errors.expectedBehavior.message}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="actualBehavior">
              Actual Behavior <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="actualBehavior"
              placeholder="What actually happened?"
              rows={3}
              {...form.register("actualBehavior")}
            />
            {form.formState.errors.actualBehavior && (
              <p className="text-sm text-destructive">
                {form.formState.errors.actualBehavior.message}
              </p>
            )}
          </div>
        </div>

        {/* Steps to Reproduce */}
        <div className="space-y-2">
          <Label htmlFor="stepsToReproduce">
            Steps to Reproduce <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="stepsToReproduce"
            placeholder="1. Go to...\n2. Click on...\n3. See error"
            rows={4}
            {...form.register("stepsToReproduce")}
          />
          {form.formState.errors.stepsToReproduce && (
            <p className="text-sm text-destructive">
              {form.formState.errors.stepsToReproduce.message}
            </p>
          )}
        </div>

        {/* Optional fields */}
        <details className="rounded-lg border p-4">
          <summary className="text-sm font-medium cursor-pointer text-muted-foreground hover:text-foreground">
            Additional Information (optional)
          </summary>
          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="deviceInfo">Device Info</Label>
              <Input id="deviceInfo" {...form.register("deviceInfo")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="appVersion">App Version</Label>
              <Input
                id="appVersion"
                placeholder="e.g. 1.0.5"
                {...form.register("appVersion")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="platform">Platform</Label>
              <Input
                id="platform"
                placeholder="e.g. Android, iOS, Web"
                {...form.register("platform")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="currentPage">Current Page</Label>
              <Input
                id="currentPage"
                placeholder="Where did this happen?"
                {...form.register("currentPage")}
              />
            </div>
          </div>
        </details>

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
              {isOffline ? "Save Offline" : "Submit Bug Report"}
            </>
          )}
        </Button>
      </form>
    </div>
  );
}
