import { useId, useRef } from "react";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { SvgIcon } from "~/components/ui/SvgIcon";

export interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "danger" | "warning" | "info";
  isLoading?: boolean;
}

const VARIANT_STYLES = {
  danger: {
    icon: "text-error-fg",
    iconBg: "bg-error/10",
    buttonVariant: "danger" as const,
    buttonClass: "",
  },
  warning: {
    icon: "text-warning-fg",
    iconBg: "bg-warning/10",
    buttonVariant: "ghost" as const,
    buttonClass: "btn-tactile border-warning bg-warning text-warning-content hover:bg-warning/90",
  },
  info: {
    icon: "text-info-fg",
    iconBg: "bg-info/10",
    buttonVariant: "ghost" as const,
    buttonClass: "btn-tactile border-info bg-info text-info-content hover:bg-info/90",
  },
};

export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title = "确认操作",
  message,
  confirmText = "确认",
  cancelText = "取消",
  variant = "danger",
  isLoading = false,
}: ConfirmModalProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const styles = VARIANT_STYLES[variant];

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      dismissible={!isLoading}
      labelledBy={titleId}
      initialFocusRef={cancelRef}
      className="w-full max-w-md p-4"
    >
      <div className="flex items-start gap-3">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${styles.iconBg}`}
        >
          <SvgIcon name="triangle-alert" size={20} className={styles.icon} />
        </div>

        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="m-0 text-md font-bold">
            {title}
          </h3>
          <p className="m-0 mt-1 text-sm text-ink-muted">{message}</p>
        </div>
      </div>

      <div className="dialog-actions">
        <Button
          ref={cancelRef}
          variant="ghost"
          size="sm"
          onClick={onClose}
          disabled={isLoading}
        >
          {cancelText}
        </Button>
        <Button
          variant={styles.buttonVariant}
          size="sm"
          className={styles.buttonClass}
          onClick={onConfirm}
          disabled={isLoading}
        >
          {isLoading ? (
            <span className="spinner-doodle h-3.5 w-3.5" aria-hidden="true" />
          ) : null}
          {confirmText}
        </Button>
      </div>
    </Dialog>
  );
}
