import { beforeEach, describe, expect, it, vi } from "vitest";

const sonnerMock = vi.hoisted(() => ({
	success: vi.fn(),
	error: vi.fn(),
	warning: vi.fn(),
	info: vi.fn((_title: string, opts?: { id?: string }) => opts?.id ?? "sonner-info-1"),
	dismiss: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: sonnerMock }));

import { toast } from "./toast";

describe("toast.dismiss", () => {
	beforeEach(() => {
		Object.values(sonnerMock).forEach((fn) => fn.mockClear());
	});

	it("dismisses exactly the toast whose id the call returned", () => {
		const pending = toast.info({ title: "导出中", message: "正在生成" });
		toast.warning({ title: "别的提示", message: "保留" });
		expect(pending).toBe("sonner-info-1");
		toast.dismiss(pending);
		expect(sonnerMock.dismiss).toHaveBeenCalledTimes(1);
		expect(sonnerMock.dismiss).toHaveBeenCalledWith(pending);
		toast.dismiss("toast-unknown");
		expect(sonnerMock.dismiss).toHaveBeenCalledWith("toast-unknown");
	});
});
