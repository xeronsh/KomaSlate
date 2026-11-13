import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const script = resolve(__dirname, "check-bundle-budget.mjs");

function dist(files: Record<string, Buffer>, indexHtml?: string) {
	const dir = mkdtempSync(join(tmpdir(), "budget-"));
	mkdirSync(join(dir, "assets"));
	for (const [name, bytes] of Object.entries(files)) {
		writeFileSync(join(dir, "assets", name), bytes);
	}
	if (indexHtml !== undefined) {
		writeFileSync(join(dir, "index.html"), indexHtml);
	}
	return dir + "/";
}

describe("check-bundle-budget", () => {
	it("接受指定的构建目录，未超预算时退出 0", () => {
		const res = spawnSync(
			process.execPath,
			[script, dist({ "index.js": Buffer.from("console.log(1)") })],
			{ encoding: "utf-8" },
		);
		expect(res.status).toBe(0);
		expect(res.stdout).toMatch(/total \(budget 360/);
	});

	it("单个 chunk 超过 150 KB（gzip）时退出 1", () => {
		const res = spawnSync(
			process.execPath,
			[script, dist({ "index.js": randomBytes(160 * 1024) })],
			{ encoding: "utf-8" },
		);
		expect(res.status).toBe(1);
		expect(res.stderr).toMatch(/over budget/);
	});

	it("校验 index.html 首屏入口与 modulepreload 总和，超过 150 KB 时拦截退出 1", () => {
		const html = `
			<script type="module" crossorigin src="/assets/index.js"></script>
			<link rel="modulepreload" crossorigin href="/assets/vendor.js">
		`;
		const okRes = spawnSync(
			process.execPath,
			[
				script,
				dist(
					{
						"index.js": Buffer.from("console.log(1)"),
						"vendor.js": Buffer.from("export const a = 1;"),
					},
					html,
				),
			],
			{ encoding: "utf-8" },
		);
		expect(okRes.status).toBe(0);
		expect(okRes.stdout).toMatch(/initial \(budget 150\)/);

		const overRes = spawnSync(
			process.execPath,
			[
				script,
				dist(
					{
						"index.js": randomBytes(90 * 1024),
						"vendor.js": randomBytes(80 * 1024),
					},
					html,
				),
			],
			{ encoding: "utf-8" },
		);
		expect(overRes.status).toBe(1);
		expect(overRes.stderr).toMatch(/over budget: initial/);
	});
});
