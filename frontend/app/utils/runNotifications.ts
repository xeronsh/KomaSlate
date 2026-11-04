/**
 * 「完成后通知我」（P1-8）：一次生成要十几分钟，用户会切走。
 *
 * - 浏览器通知只在用户点按钮时请求权限，从不自动弹授权框。
 * - 开启后：停在确认点、完成、失败时各发一条；完成或失败后自动关掉。
 * - 标签页在后台时，同样的事件会给标题加角标（不需要授权），回到页面就清掉。
 */

export type RunNotifyKind = "gate" | "completed" | "failed";
export type NotifyAvailability = "unsupported" | "default" | "granted" | "denied";

const enabled = new Set<number>();
const listeners = new Set<() => void>();
let version = 0;

function changed(): void {
	version += 1;
	for (const listener of listeners) listener();
}

export function subscribeRunNotifications(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function runNotificationsVersion(): number {
	return version;
}

export function notificationAvailability(): NotifyAvailability {
	if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
	return Notification.permission as NotifyAvailability;
}

export function isRunNotifyEnabled(projectId: number): boolean {
	return enabled.has(projectId);
}

/** 按钮点击：第一次在这里请求权限；被拒或不支持时返回 false，只保留标题角标。 */
export async function toggleRunNotify(projectId: number): Promise<boolean> {
	if (enabled.has(projectId)) {
		enabled.delete(projectId);
		changed();
		return false;
	}
	let permission = notificationAvailability();
	if (permission === "default") {
		try {
			permission = (await Notification.requestPermission()) as NotifyAvailability;
		} catch {
			permission = notificationAvailability();
		}
	}
	if (permission !== "granted") {
		changed();
		return false;
	}
	enabled.add(projectId);
	changed();
	return true;
}

const BADGE: Record<RunNotifyKind, string> = {
	gate: "待确认",
	completed: "已完成",
	failed: "失败",
};

let badge: string | null = null;
let restoreBound = false;
const badgeListeners = new Set<() => void>();

function setBadge(next: string | null): void {
	if (badge === next) return;
	badge = next;
	for (const listener of badgeListeners) listener();
}

function clearBadgeOnReturn(): void {
	if (typeof document === "undefined" || document.visibilityState === "hidden") return;
	setBadge(null);
}

/** 标签页标题角标（「待确认」等），由工作台拼进 document.title，回到页面即清除。 */
export function titleBadge(): string | null {
	return badge;
}

export function subscribeTitleBadge(listener: () => void): () => void {
	badgeListeners.add(listener);
	return () => {
		badgeListeners.delete(listener);
	};
}

/** 拼标题：「【待确认】待确认 · 故事大纲 · 灯塔与猫 - KomaSlate」 */
export function withTitleBadge(title: string, current: string | null = badge): string {
	return current ? `【${current}】${title}` : title;
}

/** 闸门确认后撤下【待确认】；完成 / 失败角标保留到用户回来。 */
export function clearGateTitleBadge(): void {
	if (badge === BADGE.gate) setBadge(null);
}

/** 后台标签页才打角标；回到页面（visibilitychange / focus）清除。 */
export function setTitleBadge(kind: RunNotifyKind): void {
	if (typeof document === "undefined" || document.visibilityState !== "hidden") return;
	setBadge(BADGE[kind]);
	if (!restoreBound) {
		restoreBound = true;
		document.addEventListener("visibilitychange", clearBadgeOnReturn);
		window.addEventListener("focus", clearBadgeOnReturn);
	}
}

export interface RunNotifyEvent {
	projectId: number;
	kind: RunNotifyKind;
	/** 「分镜画面 · 待确认」「成片已生成」 */
	body: string;
	projectTitle?: string | null;
}

/** WS 事件到达时调用：标题角标总会打（仅后台），系统通知只在开启后发。 */
export function notifyRunEvent(event: RunNotifyEvent): void {
	setTitleBadge(event.kind);
	if (!enabled.has(event.projectId)) return;
	if (event.kind !== "gate") {
		enabled.delete(event.projectId);
		changed();
	}
	if (notificationAvailability() !== "granted") return;
	try {
		const notification = new Notification(event.projectTitle ? `KomaSlate · ${event.projectTitle}` : "KomaSlate", {
			body: event.body,
			tag: `komaslate-run-${event.projectId}`,
		});
		notification.onclick = () => {
			window.focus();
			notification.close();
		};
	} catch {
		// 某些浏览器（如 Android Chrome）只允许 Service Worker 发通知：退回标题角标
	}
}

/** 测试用 */
export function resetRunNotifications(): void {
	enabled.clear();
	setBadge(null);
	changed();
}
