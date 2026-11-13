import { toast as sonnerToast } from "sonner";
import type { ToastAction } from "~/types/errors";

export interface ToastOptions {
  id?: string;
  title: string;
  message: string;
  duration?: number;
  actions?: ToastAction[];
  details?: string;
}

function toSonnerOptions(options: ToastOptions, defaultDuration: number) {
  const duration =
    options.duration === 0 || options.duration === Infinity
      ? Infinity
      : (options.duration ?? defaultDuration);
  const firstAction = options.actions?.[0];

  return {
    id: options.id,
    description: options.message,
    duration,
    action: firstAction
      ? {
          label: firstAction.label,
          onClick: firstAction.onClick,
        }
      : undefined,
  };
}

export const toast = {
  success: (options: ToastOptions): string =>
    String(sonnerToast.success(options.title, toSonnerOptions(options, 3000))),

  error: (options: ToastOptions): string =>
    String(sonnerToast.error(options.title, toSonnerOptions(options, 5000))),

  warning: (options: ToastOptions): string =>
    String(sonnerToast.warning(options.title, toSonnerOptions(options, 4000))),

  info: (options: ToastOptions): string =>
    String(sonnerToast.info(options.title, toSonnerOptions(options, 3000))),

  /** 关闭一个还在显示的 Toast（例如进行中的提示被结果替换） */
  dismiss: (id?: string) => {
    sonnerToast.dismiss(id);
  },
};
