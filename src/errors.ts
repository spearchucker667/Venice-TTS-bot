/**
 * Structured, actionable error model.
 * Audit ID: UI-009.
 */

export type AppErrorKind =
  | "auth"
  | "rate_limit"
  | "provider_unavailable"
  | "catalog_stale"
  | "unsupported_setting"
  | "network_timeout"
  | "user_abort"
  | "charged_queue_unknown"
  | "cleanup_pending"
  | "invalid_import"
  | "storage_failure"
  | "generic";

export type AppErrorDetails = {
  kind: AppErrorKind;
  title: string;
  message: string;
  actionHint: string;
  recoverable: boolean;
};

/**
 * UI-009: Normalize and classify arbitrary errors into consistent, actionable categories.
 */
export function classifyAppError(err: unknown): AppErrorDetails {
  if (!err) {
    return {
      kind: "generic",
      title: "Unknown error",
      message: "An unexpected error occurred.",
      actionHint: "Try again.",
      recoverable: true,
    };
  }

  const rawMessage =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : typeof (err as { message?: unknown }).message === "string"
          ? String((err as { message?: unknown }).message)
          : String(err);

  const status =
    typeof (err as { status?: unknown }).status === "number"
      ? (err as { status: number }).status
      : 0;

  const lower = rawMessage.toLowerCase();

  // User abort / cancel
  if (
    (err instanceof DOMException && err.name === "AbortError") ||
    lower.includes("aborted") ||
    lower.includes("abort") ||
    lower.includes("cancelled") ||
    lower.includes("canceled")
  ) {
    return {
      kind: "user_abort",
      title: "Operation cancelled",
      message: "The request or playback was stopped.",
      actionHint: "Start a new request whenever you are ready.",
      recoverable: true,
    };
  }

  // Auth / invalid or missing API key
  if (
    status === 401 ||
    status === 403 ||
    lower.includes("unauthorized") ||
    lower.includes("api key") ||
    lower.includes("invalid key") ||
    lower.includes("missing key") ||
    lower.includes("forbidden")
  ) {
    return {
      kind: "auth",
      title: "Authentication required",
      message: rawMessage || "A valid Venice API key is required to proceed.",
      actionHint: "Open Settings to enter or update your Venice API key.",
      recoverable: true,
    };
  }

  // Rate limit / quota
  if (
    status === 429 ||
    lower.includes("rate limit") ||
    lower.includes("too many requests") ||
    lower.includes("quota exceeded")
  ) {
    return {
      kind: "rate_limit",
      title: "Rate limit reached",
      message: "The provider is temporarily rate limiting requests.",
      actionHint: "Wait a few moments before trying again.",
      recoverable: true,
    };
  }

  // Network timeout / connection drops
  if (
    status === 504 ||
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("network error") ||
    lower.includes("failed to fetch")
  ) {
    return {
      kind: "network_timeout",
      title: "Network timeout",
      message: "The network connection timed out waiting for the provider.",
      actionHint: "Check your connection and retry with a shorter prompt.",
      recoverable: true,
    };
  }

  // Provider unavailable / 5xx
  if (
    status >= 500 ||
    lower.includes("service unavailable") ||
    lower.includes("bad gateway") ||
    lower.includes("internal server error")
  ) {
    return {
      kind: "provider_unavailable",
      title: "Provider unavailable",
      message: "The Venice API is temporarily unreachable or returning errors.",
      actionHint: "Check Venice API status and try again shortly.",
      recoverable: true,
    };
  }

  // Voice Changer charged queue unknown
  if (lower.includes("submission outcome is unknown") || lower.includes("charged queue")) {
    return {
      kind: "charged_queue_unknown",
      title: "Submission outcome unknown",
      message: rawMessage,
      actionHint: "Do not retry this take; start a new take to avoid duplicate charges.",
      recoverable: false,
    };
  }

  // Voice Changer cleanup pending
  if (lower.includes("cleanup not confirmed") || lower.includes("cleanup pending")) {
    return {
      kind: "cleanup_pending",
      title: "Cleanup not confirmed",
      message: rawMessage,
      actionHint: "Use 'Retry cleanup' to ensure media is released on the provider.",
      recoverable: true,
    };
  }

  // Stale catalog / model not found
  if (
    lower.includes("model not found") ||
    lower.includes("catalog stale") ||
    lower.includes("no text model") ||
    lower.includes("no model")
  ) {
    return {
      kind: "catalog_stale",
      title: "Model unavailable",
      message: rawMessage,
      actionHint: "Refresh the Venice catalog in Settings to pick an available model.",
      recoverable: true,
    };
  }

  // Unsupported setting / parameter
  if (lower.includes("unsupported") || lower.includes("not supported")) {
    return {
      kind: "unsupported_setting",
      title: "Unsupported setting",
      message: rawMessage,
      actionHint: "Adjust model parameters or switch to a compatible model in Settings.",
      recoverable: true,
    };
  }

  // Import errors
  if (
    lower.includes("import") ||
    lower.includes("chat export") ||
    lower.includes("export version")
  ) {
    return {
      kind: "invalid_import",
      title: "Invalid import format",
      message: rawMessage,
      actionHint: "Select a valid Ember chat export file (JSON format).",
      recoverable: true,
    };
  }

  // Storage quota / failure
  if (
    lower.includes("quotaexceedederror") ||
    lower.includes("storage quota") ||
    lower.includes("indexeddb")
  ) {
    return {
      kind: "storage_failure",
      title: "Storage limit reached",
      message: "Local browser storage is full or restricted in private mode.",
      actionHint: "Export existing chats and clear old conversations to free space.",
      recoverable: true,
    };
  }

  // Fallback generic error
  return {
    kind: "generic",
    title: "Application notice",
    message: rawMessage,
    actionHint: "Retry the operation or refresh the page.",
    recoverable: true,
  };
}
