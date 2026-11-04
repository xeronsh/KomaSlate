import { useEffect, useRef, useState } from "react";

/** Live preview of the current LLM call (`llm_stream` frames are snapshots). */
export interface LiveStream {
	streamId: string;
	agent: string;
	status: "streaming" | "error";
	thinking: string;
	text: string;
	chars: number;
	error?: string;
}

const ANCHOR = 8;

/**
 * Readable values arrive joined by " · ". While a new value is still being
 * typed, or the tail window cut through one, a bare separator can sit at
 * either end; it carries nothing, so it is not shown.
 */
export function tidyStreamText(text: string): string {
	return text.replace(/^\s*·\s*/, "").replace(/\s*·\s*$/, "");
}

const FAILED_KEY = "komaslate.failedStream.";

/** The interrupted output survives a reload of a failed project (same tab). */
export function rememberFailedStream(projectId: number, stream: LiveStream | null): void {
	try {
		if (stream?.status === "error") sessionStorage.setItem(FAILED_KEY + projectId, JSON.stringify(stream));
		else sessionStorage.removeItem(FAILED_KEY + projectId);
	} catch {
		// storage unavailable: the row just does not survive a reload
	}
}

export function recallFailedStream(projectId: number): LiveStream | null {
	try {
		const raw = sessionStorage.getItem(FAILED_KEY + projectId) ?? sessionStorage.getItem("openoii.failedStream." + projectId);
		const stream = raw ? (JSON.parse(raw) as LiveStream) : null;
		return stream?.status === "error" && typeof stream.streamId === "string" ? stream : null;
	} catch {
		return null;
	}
}

/**
 * Split the next snapshot into what is already on screen and what still has
 * to be typed out. Frames carry a sliding tail, so the old text is located by
 * its last few code points instead of assuming a prefix.
 */
export function splitForReveal(shown: string, target: string): { base: string; pending: string[] } {
	if (target.startsWith(shown)) {
		return { base: shown, pending: Array.from(target.slice(shown.length)) };
	}
	const points = Array.from(shown);
	const anchor = points.slice(-ANCHOR).join("");
	const at = anchor.length >= 2 ? target.lastIndexOf(anchor) : -1;
	if (at < 0) return { base: target, pending: [] };
	const end = at + anchor.length;
	return { base: target.slice(0, end), pending: Array.from(target.slice(end)) };
}

/** Frames arrive ~4×/s; newly arrived characters are typed out over this window. */
const REVEAL_MS = 240;

function prefersReducedMotion(): boolean {
	return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/**
 * Smooth typewriter over snapshot frames. Code-point based, so CJK and emoji
 * never render half a surrogate pair. Reduced motion shows frames as they come.
 */
export function useTypewriter(target: string): string {
	const [shown, setShown] = useState(target);
	const shownRef = useRef(target);

	useEffect(() => {
		const { base, pending } = splitForReveal(shownRef.current, target);
		const commit = (value: string) => {
			shownRef.current = value;
			setShown(value);
		};
		if (pending.length === 0 || prefersReducedMotion()) {
			commit(target);
			return;
		}
		commit(base);
		let frame = 0;
		const start = performance.now();
		const tick = (now: number) => {
			const count = Math.min(pending.length, Math.ceil(((now - start) / REVEAL_MS) * pending.length));
			commit(base + pending.slice(0, count).join(""));
			if (count < pending.length) frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	}, [target]);

	return shown;
}
