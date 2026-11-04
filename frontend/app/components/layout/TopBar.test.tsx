import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { TopBar } from "./TopBar";

vi.mock("react-router-dom", async () => {
	const actual = await vi.importActual<typeof import("react-router-dom")>(
		"react-router-dom",
	);
	return {
		...actual,
		Link: ({
			children,
			to,
			...rest
		}: {
			children: ReactNode;
			to: string;
			[key: string]: unknown;
		}) => (
			<a href={to} {...rest}>
				{children}
			</a>
		),
		useLocation: () => ({ pathname: "/" }),
	};
});

vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({
		data: [
			{
				id: 16,
				title: "chrome-devtools-audit-20260613070939",
				status: "ready",
			},
		],
	}),
}));

vi.mock("~/stores/themeStore", () => ({
	useThemeStore: vi.fn(() => ({ theme: "light", toggleTheme: vi.fn() })),
}));

vi.mock("~/stores/settingsStore", () => ({
	useSettingsStore: vi.fn(() => ({ openModal: vi.fn() })),
}));

describe("TopBar", () => {
	it("constrains the project dropdown and keeps project chrome app-level by default", () => {
		const { container } = render(<TopBar projectId={16} />);

		expect(container.querySelector("header")).toHaveClass("chrome-row", "px-2");
		expect(container.querySelector("header")).toHaveAttribute("data-shell", "topbar");
		// <sm 收紧到 6rem 防止长项目名溢出叠印；sm+ 维持 14rem
		expect(
			container.querySelector('button[aria-haspopup="listbox"]'),
		).toHaveClass("max-w-24", "sm:max-w-56");
		expect(screen.getAllByRole("navigation", { name: "主导航" }).length).toBeGreaterThan(0);
		expect(screen.getByRole("button", { name: "切换暗色主题" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "设置" })).toBeInTheDocument();
	});

	it("keeps the dropdown button clipped inside its wrapper and shields the nav from overflow", () => {
		const { container } = render(<TopBar projectId={16} />);

		const button = container.querySelector('button[aria-haspopup="listbox"]');
		// 按钮外层裁剪盒防止 shrink-to-fit 溢出叠印到 nav 上
		expect(button?.parentElement).toHaveClass("overflow-hidden");
		// wrapper 最小宽不低于按钮 min-content，且不再允许被压到 0
		expect(button?.parentElement?.parentElement).toHaveClass("min-w-12");
		expect(button?.parentElement?.parentElement).not.toHaveClass("min-w-0");
		// 项目名截断时通过 title 提供全名
		expect(
			screen.getByTitle("chrome-devtools-audit-20260613070939"),
		).toHaveTextContent("chrome-devtools-audit-20260613070939");
		// nav 不参与收缩，避免命中区域被挤压
		const nav = screen.getAllByRole("navigation", { name: "主导航" })[0];
		expect(nav).toHaveClass("shrink-0");
	});

	it("exposes global nav on home chrome", () => {
		render(<TopBar />);

		expect(screen.getByRole("link", { name: "KomaSlate 首页" })).toBeInTheDocument();
		// nav labels appear in both desktop+mobile; ensure present
		expect(screen.getAllByRole("link", { name: /创作/ }).length).toBeGreaterThan(0);
		expect(screen.getAllByRole("link", { name: /项目/ }).length).toBeGreaterThan(0);
		expect(screen.getAllByRole("link", { name: /宇宙/ }).length).toBeGreaterThan(0);
	});
});
