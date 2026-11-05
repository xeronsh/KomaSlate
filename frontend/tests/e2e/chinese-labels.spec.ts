import { expect, test, type Page } from "@playwright/test";

const now = "2026-10-29T08:00:00Z";
const universe = {
	id: 1,
	name: "灯塔宇宙",
	description: "海边灯塔、守夜人与一只橘猫的连续短篇。",
	world_setting: "海边孤岛上的老灯塔。",
	style_rules: "暖色灯光对冷蓝夜海。",
	cover_image_url: null,
	is_active: true,
	created_at: now,
	updated_at: now,
	projects_count: 1,
	shared_characters_count: 1,
};
const shared = [
	{
		id: 1,
		universe_id: 1,
		name: "阿岚",
		description: "年轻的灯塔守夜人。",
		visual_notes: null,
		canonical_image_url: null,
		reference_images: null,
		has_embedding: false,
		character_tags: "主角,守夜人",
		source_project_id: 27,
		source_character_id: 46,
		version: 1,
		is_active: true,
		created_at: now,
		updated_at: now,
		reference_images_count: 0,
	},
];
const detail = {
	...universe,
	chapters: [
		{ id: 1, universe_id: 1, project_id: 25, chapter_number: 1, chapter_title: "守夜", is_main_story: true, created_at: now, project_title: "灯塔守夜人" },
	],
	shared_characters: shared,
};

async function mockUniverse(page: Page) {
	await page.route("**/api/v1/universes**", (route) => {
		const req = route.request();
		const path = new URL(req.url()).pathname;
		if (req.method() !== "GET") return route.fulfill({ status: 409, contentType: "application/json", body: "{}" });
		if (path === "/api/v1/universes") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([universe]) });
		if (path === "/api/v1/universes/1") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(detail) });
		if (path.startsWith("/api/v1/universes/1/shared-characters")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(shared) });
		return route.fallback();
	});
}

/** 页面上可见的英文大写/等宽栏目名（eyebrow）：只允许数字、#、v1 这类编号用等宽 */
async function englishEyebrows(page: Page) {
	return page.evaluate(() =>
		Array.from(document.querySelectorAll<HTMLElement>("header p, [data-shell] p, [data-shell] span"))
			.filter((el) => el.children.length === 0 && /[A-Za-z]{3,}/.test(el.textContent ?? ""))
			.filter((el) => {
				const cs = getComputedStyle(el);
				return cs.textTransform === "uppercase";
			})
			.map((el) => el.textContent?.trim()),
	);
}

test("universe detail speaks Chinese and keeps 导入到 on one line", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await mockUniverse(page);
	await page.goto("/universes/1");
	await expect(page.getByRole("heading", { name: "灯塔宇宙" })).toBeVisible();
	await expect(page.getByText("共享角色库", { exact: true })).toBeVisible();
	await expect(page.getByText(/universe detail/i)).toHaveCount(0);
	await expect(page.getByText(/^cast$/i)).toHaveCount(0);

	const label = page.locator("label", { hasText: "导入到" });
	const lines = await label.evaluate((el) => {
		const text = Array.from(el.childNodes).find((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.includes("导入到"))!;
		const range = document.createRange();
		range.selectNodeContents(text);
		return new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top))).size;
	});
	expect(lines).toBe(1);
	expect(await englishEyebrows(page)).toEqual([]);
});

for (const [path, heading] of [
	["/", "把一句想法，拍成可精修的分镜台本"],
	["/projects", "项目库"],
	["/universes", "故事宇宙"],
] as const) {
	test(`page header on ${path} is Chinese with no uppercase English tags`, async ({ page }) => {
		await mockUniverse(page);
		await page.goto(path);
		await expect(page.locator('[data-shell="page-header"] h1').first()).toHaveText(heading);
		expect(await englishEyebrows(page)).toEqual([]);
	});
}
