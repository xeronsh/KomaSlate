import { describe, it, expect, vi, beforeEach } from "vitest";

const sonnerMock = vi.hoisted(() => ({
  success: vi.fn(() => "s-1"),
  error: vi.fn(() => "e-1"),
  warning: vi.fn(() => "w-1"),
  info: vi.fn(() => "i-1"),
  dismiss: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: sonnerMock }));

let toast: typeof import("./toast").toast;

beforeEach(async () => {
  Object.values(sonnerMock).forEach((fn) => fn.mockClear());
  vi.resetModules();
  toast = (await import("./toast")).toast;
});

describe("toast utils (sonner adapter)", () => {
  it("success forwards title, description and default duration to sonner", () => {
    const id = toast.success({ title: "ok", message: "done" });
    expect(id).toBe("s-1");
    expect(sonnerMock.success).toHaveBeenCalledWith(
      "ok",
      expect.objectContaining({ description: "done", duration: 3000 }),
    );
  });

  it("error forwards id, Infinity for duration=0, and first action", () => {
    const onClick = vi.fn();
    toast.error({
      id: "ws-connection-status",
      title: "err",
      message: "fail",
      duration: 0,
      actions: [{ label: "重试", onClick }],
    });
    expect(sonnerMock.error).toHaveBeenCalledWith(
      "err",
      expect.objectContaining({
        id: "ws-connection-status",
        description: "fail",
        duration: Infinity,
        action: { label: "重试", onClick },
      }),
    );
  });

  it("warning forwards title, message and 4000ms default duration", () => {
    toast.warning({ title: "w", message: "m" });
    expect(sonnerMock.warning).toHaveBeenCalledWith(
      "w",
      expect.objectContaining({ description: "m", duration: 4000 }),
    );
  });

  it("info forwards title, message and 3000ms default duration", () => {
    toast.info({ title: "i", message: "m" });
    expect(sonnerMock.info).toHaveBeenCalledWith(
      "i",
      expect.objectContaining({ description: "m", duration: 3000 }),
    );
  });

  it("allows custom duration", () => {
    toast.success({ title: "ok", message: "m", duration: 1000 });
    expect(sonnerMock.success).toHaveBeenCalledWith(
      "ok",
      expect.objectContaining({ duration: 1000 }),
    );
  });
});
