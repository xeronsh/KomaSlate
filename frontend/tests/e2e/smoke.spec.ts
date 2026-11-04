import { expect, test } from "@playwright/test";

test("homepage exposes the story bootstrap flow", async ({ page }) => {
	await page.goto("/");

	await expect(page).toHaveTitle(/KomaSlate/);
	await expect(page.getByRole("heading", { name: "把一句想法，拍成可精修的分镜台本" })).toBeVisible();

	const storyInput = page.getByLabel("输入你的故事创意");
	const startButton = page.getByRole("button", { name: "开始创作" });

	await expect(storyInput).toBeVisible();
	await expect(startButton).toBeDisabled();

	await storyInput.fill("一个灯塔管理员发现会发光的地图。");
	await expect(startButton).toBeEnabled();
	await expect(page.getByRole("button", { name: /逐步确认/ })).toHaveAttribute("aria-pressed", "true");
	await expect(page.getByRole("button", { name: /自动确认/ })).toBeVisible();
});

test.describe("mobile tap targets", () => {
	test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

	for (const path of ["/", "/projects", "/universes"]) {
		test(`every visible tap target on ${path} is at least 44px`, async ({ page }) => {
			await page.goto(path);
			await page.waitForLoadState("networkidle");
			const small = await page.evaluate(() => {
				const nodes = Array.from(document.querySelectorAll<HTMLElement>("button, a[href], select, summary, input[type=checkbox], input[type=radio]"));
				return nodes
					.map((node) => {
						// a checkbox is tapped through its label
						const target = node instanceof HTMLInputElement ? (node.closest("label") ?? node) : node;
						const rect = target.getBoundingClientRect();
						const label = node.getAttribute("aria-label") || node.textContent?.trim().slice(0, 30) || node.tagName;
						return { label, width: Math.round(rect.width), height: Math.round(rect.height) };
					})
					.filter(({ width, height }) => width > 0 && height > 0 && (width < 44 || height < 44));
			});
			expect(small).toEqual([]);
		});
	}
});
