import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	isRunNotifyEnabled,
	notifyRunEvent,
	clearGateTitleBadge,
	resetRunNotifications,
	titleBadge,
	toggleRunNotify,
	withTitleBadge,
} from "./runNotifications";

class FakeNotification {
	static permission: NotificationPermission = "default";
	static requestPermission = vi.fn(async () => {
		FakeNotification.permission = "granted";
		return "granted" as NotificationPermission;
	});
	static sent: Array<{ title: string; body?: string }> = [];
	onclick: (() => void) | null = null;
	constructor(title: string, options?: NotificationOptions) {
		FakeNotification.sent.push({ title, body: options?.body });
	}
	close() {}
}

function setHidden(hidden: boolean) {
	Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
}

describe("run notifications", () => {
	beforeEach(() => {
		FakeNotification.permission = "default";
		FakeNotification.sent = [];
		FakeNotification.requestPermission.mockClear();
		vi.stubGlobal("Notification", FakeNotification);
		document.title = "KomaSlate";
		setHidden(false);
	});
	afterEach(() => {
		resetRunNotifications();
		vi.unstubAllGlobals();
		setHidden(false);
	});

	it("asks for permission only when the button is clicked", async () => {
		notifyRunEvent({ projectId: 1, kind: "gate", body: "分镜画面 · 待确认" });
		expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
		expect(FakeNotification.sent).toEqual([]);

		expect(await toggleRunNotify(1)).toBe(true);
		expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
		expect(isRunNotifyEnabled(1)).toBe(true);
	});

	it("notifies at a gate and on completion, then switches itself off", async () => {
		await toggleRunNotify(1);
		notifyRunEvent({ projectId: 1, kind: "gate", body: "分镜画面 · 待确认", projectTitle: "灯塔与猫" });
		expect(isRunNotifyEnabled(1)).toBe(true);
		notifyRunEvent({ projectId: 1, kind: "completed", body: "成片已生成" });
		expect(FakeNotification.sent).toEqual([
			{ title: "KomaSlate · 灯塔与猫", body: "分镜画面 · 待确认" },
			{ title: "KomaSlate", body: "成片已生成" },
		]);
		expect(isRunNotifyEnabled(1)).toBe(false);
		notifyRunEvent({ projectId: 1, kind: "failed", body: "x" });
		expect(FakeNotification.sent).toHaveLength(2);
	});

	it("a denied permission leaves the toggle off and sends nothing", async () => {
		FakeNotification.requestPermission.mockImplementationOnce(async () => {
			FakeNotification.permission = "denied";
			return "denied";
		});
		expect(await toggleRunNotify(2)).toBe(false);
		notifyRunEvent({ projectId: 2, kind: "failed", body: "生成失败" });
		expect(FakeNotification.sent).toEqual([]);
	});

	it("badges the title while the tab is in the background and clears it on return", () => {
		notifyRunEvent({ projectId: 3, kind: "gate", body: "x" });
		expect(titleBadge()).toBeNull();
		setHidden(true);
		notifyRunEvent({ projectId: 3, kind: "gate", body: "x" });
		expect(titleBadge()).toBe("待确认");
		expect(withTitleBadge("待确认 · 故事大纲 · 灯塔与猫 - KomaSlate")).toBe("【待确认】待确认 · 故事大纲 · 灯塔与猫 - KomaSlate");
		notifyRunEvent({ projectId: 3, kind: "completed", body: "x" });
		expect(titleBadge()).toBe("已完成");
		setHidden(false);
		document.dispatchEvent(new Event("visibilitychange"));
		expect(titleBadge()).toBeNull();
		expect(withTitleBadge("KomaSlate")).toBe("KomaSlate");
	});

	it("drops the 待确认 badge once the gate is confirmed but keeps 已完成 / 失败", () => {
		setHidden(true);
		notifyRunEvent({ projectId: 4, kind: "gate", body: "x" });
		clearGateTitleBadge();
		expect(titleBadge()).toBeNull();
		notifyRunEvent({ projectId: 4, kind: "failed", body: "x" });
		clearGateTitleBadge();
		expect(titleBadge()).toBe("失败");
	});
});
