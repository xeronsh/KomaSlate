import { useId, type ReactNode } from "react";
import { Button } from "./Button";
import { Dialog } from "./Dialog";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  actions?: ReactNode;
}

export function Modal({ isOpen, onClose, title, children, actions }: ModalProps) {
  const titleId = useId();
  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      labelledBy={title ? titleId : undefined}
      className="w-full max-w-lg p-4 sm:p-5"
    >
      {title && (
        <h3 id={titleId} className="m-0 border-b border-line pb-2.5 text-md font-semibold text-ink">
          {title}
        </h3>
      )}
      <div className="py-3 text-base">{children}</div>
      <div className="dialog-actions border-t border-line pt-3">
        {actions ?? (
          <Button variant="ghost" size="sm" onClick={onClose}>
            关闭
          </Button>
        )}
      </div>
    </Dialog>
  );
}
