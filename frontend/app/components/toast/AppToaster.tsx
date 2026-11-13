import { Toaster as SonnerToaster } from "sonner";

export function AppToaster() {
  return (
    <SonnerToaster
      position="top-right"
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex items-center gap-2.5 w-full max-w-sm p-3 rounded-lg border border-line shadow-panel bg-paper-100 text-ink text-sm z-toast",
          title: "font-medium text-ink",
          description: "text-xs text-ink-muted",
          actionButton:
            "btn-tactile bg-primary text-primary-content text-xs px-2 py-1 rounded-md",
          error: "border-error text-error-fg bg-paper-100",
          success: "border-success text-success-fg bg-paper-100",
          warning: "border-warning text-warning-fg bg-paper-100",
          info: "border-info text-info-fg bg-paper-100",
        },
      }}
    />
  );
}
