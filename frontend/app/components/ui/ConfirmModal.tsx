import { useId, useRef } from "react";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { SvgIcon } from "~/components/ui/SvgIcon";

interface ConfirmModalProps {
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

  const variantStyles = {
    danger: {
      icon: "text-error-fg",
      iconBg: "bg-error/10 border-error/25",
      button: "bg-error text-error-content border-error hover:bg-error/90",
    },
    warning: {
      icon: "text-warning-fg",
      iconBg: "bg-warning/10 border-warning/25",
      button: "bg-warning text-warning-content border-warning hover:bg-warning/90",
    },
    info: {
      icon: "text-info-fg",
      iconBg: "bg-info/10 border-info/25",
      button: "bg-info text-info-content border-info hover:bg-info/90",
    },
  };

  const styles = variantStyles[variant];

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      dismissible={!isLoading}
      labelledBy={titleId}
      initialFocusRef={cancelRef}
      className="w-full max-w-md p-4 sm:p-5"
    >
      <div className="flex items-start gap-3">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border ${styles.iconBg}`}
        >
          <SvgIcon name="triangle-alert" size={20} className={styles.icon} />
        </div>

        <div className="min-w-0 flex-1">
          <h3
            id={titleId}
            className="m-0 text-md font-semibold text-ink"
          >
            {title}
          </h3>
          <p className="m-0 mt-1 text-sm leading-relaxed text-ink-muted">{message}</p>
        </div>
      </div>

      <div className="dialog-actions border-t border-line pt-3">
        <Button
          ref={cancelRef}
          variant="secondary"
          size="sm"
          onClick={onClose}
          disabled={isLoading}
        >
          {cancelText}
        </Button>
        <button
          type="button"
          className={`btn-doodle btn-tactile ${styles.button} h-8 touch-target-dense justify-center px-2.5 text-xs disabled:opacity-50`}
          onClick={onConfirm}
          disabled={isLoading}
        >
          {isLoading && <span className="spinner-doodle h-4 w-4" />}
          {confirmText}
        </button>
      </div>
    </Dialog>
  );
}
