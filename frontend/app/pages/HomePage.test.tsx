import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HomePage } from "./HomePage";
import { projectsApi } from "~/services/api";

vi.mock("~/services/api", () => ({
	projectsApi: {
		list: vi.fn(() =>
			Promise.resolve([
				{ id: 1, title: "旧项目一", status: "ready", updated_at: "2026-01-01T00:00:00Z" },
				{ id: 2, title: "旧项目二", status: "draft", updated_at: "2026-01-03T00:00:00Z" },
				{ id: 3, title: "旧项目三", status: "planning", updated_at: "2026-01-02T00:00:00Z" },
				{ id: 4, title: "旧项目四", status: "draft", updated_at: "2025-12-01T00:00:00Z" },
			])),
		create: vi.fn(() => Promise.resolve({ id: 7 })),
		uploadReference: vi.fn(() => Promise.resolve({ url: "/r.png", reference_images: ["/r.png"] })),
	},
	universesApi: {
		list: vi.fn(() =>
			Promise.resolve([
				{
					id: 12,
					name: "测试宇宙",
					description: null,
					world_setting: null,
					style_rules: null,
					cover_image_url: null,
					is_active: true,
					created_at: "2026-01-01T00:00:00Z",
					updated_at: "2026-01-01T00:00:00Z",
					projects_count: 2,
					shared_characters_count: 1,
				},
			])),
	},
}));

vi.mock("~/stores/themeStore", () => ({
	useThemeStore: vi.fn(() => ({ theme: "light", toggleTheme: vi.fn() })),
}));

vi.mock("~/stores/settingsStore", () => ({
	useSettingsStore: vi.fn(() => ({ openModal: vi.fn() })),
}));

function ProjectLocation() {
	const location = useLocation();
	return <p data-testid="location">{location.pathname + location.search}</p>;
}

const create = vi.mocked(projectsApi.create);
const uploadReference = vi.mocked(projectsApi.uploadReference);

function renderHomePage(initialEntry = "/") {
	const queryClient = new QueryClient();
	return render(
		<QueryClientProvider client={queryClient}>
			<MemoryRouter initialEntries={[initialEntry]}>
				<Routes>
					<Route path="/" element={<HomePage />} />
					<Route path="/project/:id" element={<ProjectLocation />} />
				</Routes>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

describe("HomePage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("starts with one story field and no workflow preset section", () => {
		const { container } = renderHomePage();
		expect(screen.getByRole("heading", { name: "把一句想法，拍成可精修的分镜台本。" })).toBeInTheDocument();
		expect(screen.getByLabelText("输入你的故事创意")).toBeInTheDocument();
		expect(container.querySelector('[data-shell="desk-section"]')).not.toBeNull();
		expect(screen.queryByRole("heading", { name: "工作流" })).toBeNull();
		expect(screen.queryByRole("heading", { name: "创作设置" })).toBeNull();
	});

	it("lists the three most recent projects and fills an example prompt", async () => {
		const user = userEvent.setup();
		renderHomePage();
		const recent = await screen.findByRole("region", { name: "最近项目" });
		const links = Array.from(recent.querySelectorAll("li a")).map((a) => a.textContent);
		expect(links).toEqual(["旧项目二草稿", "旧项目三规划中", "旧项目一成片可用"]);
		const example = screen.getAllByRole("button", { name: /灯塔管理员/ })[0];
		await user.click(example);
		expect(screen.getByLabelText("输入你的故事创意")).toHaveValue(example.textContent);
		expect(screen.queryByRole("button", { name: /灯塔管理员/ })).toBeNull();
	});

	it("offers step-by-step and auto-confirm creation modes", async () => {
		const user = userEvent.setup();
		renderHomePage();
		const interactive = screen.getByRole("button", { name: /逐步确认/ });
		const yolo = screen.getByRole("button", { name: /自动确认/ });
		expect(interactive).toHaveAttribute("aria-pressed", "true");
		expect(yolo).toHaveAttribute("aria-pressed", "false");
		await user.click(yolo);
		expect(yolo).toHaveAttribute("aria-pressed", "true");
	});

	it("gives mode cards room and press feedback without the dense touch floor", () => {
		renderHomePage();
		for (const name of [/逐步确认/, /自动确认/]) {
			const card = screen.getByRole("button", { name });
			// touch-target-dense 会把 min-height 压回 32px，盖掉 min-h-14
			expect(card).not.toHaveClass("touch-target-dense");
			expect(card).toHaveClass("min-h-14", "py-2.5", "press");
		}
	});

	it("creates an interactive project and starts it on the workbench", async () => {
		renderHomePage();
		fireEvent.change(screen.getByLabelText("输入你的故事创意"), {
			target: { value: "My story" },
		});
		fireEvent.click(screen.getByRole("button", { name: "开始创作" }));
		expect(await screen.findByTestId("location")).toHaveTextContent(
			"/project/7?autoStart=true&skill=story-anime",
		);
		expect(create).toHaveBeenCalledWith(
			expect.objectContaining({ story: "My story", creation_mode: "review", style: "anime" }),
		);
		expect(uploadReference).not.toHaveBeenCalled();
	});

	it("sends the optional settings and uploads reference images after creating", async () => {
		const user = userEvent.setup();
		renderHomePage();
		fireEvent.change(screen.getByLabelText("输入你的故事创意"), {
			target: { value: "灯塔" },
		});
		await user.click(screen.getByText(/画面设置（可选）/));
		await user.selectOptions(screen.getByLabelText("画面风格"), "watercolor");
		await user.type(screen.getByLabelText("镜头数"), "6");
		await user.type(screen.getByLabelText("角色提示（每行一个）"), "灯塔管理员{enter}{enter}黑猫");
		const file = new File(["x"], "ref.png", { type: "image/png" });
		await user.upload(screen.getByLabelText("选择参考图"), file);
		await user.click(screen.getByRole("button", { name: "开始创作" }));
		await screen.findByTestId("location");
		expect(create).toHaveBeenCalledWith(
			expect.objectContaining({
				style: "watercolor",
				target_shot_count: 6,
				character_hints: ["灯塔管理员", "黑猫"],
			}),
		);
		expect(uploadReference).toHaveBeenCalledWith(7, file);
	});

	it("creates an auto-confirm project and starts it on the workbench", async () => {
		const user = userEvent.setup();
		renderHomePage();
		fireEvent.change(screen.getByLabelText("输入你的故事创意"), {
			target: { value: "A quick story" },
		});
		await user.click(screen.getByRole("button", { name: /自动确认/ }));
		await user.click(screen.getByRole("button", { name: "开始创作" }));
		expect(await screen.findByTestId("location")).toHaveTextContent("/project/7?autoStart=true");
		expect(create).toHaveBeenCalledWith(
			expect.objectContaining({ story: "A quick story", creation_mode: "quick" }),
		);
	});

	it("uses a requested universe chapter from the route", async () => {
		renderHomePage("/?universeId=12&chapterNumber=5");
		await screen.findByText(/将加入「测试宇宙」宇宙 · 第 5 章/);
		fireEvent.change(screen.getByLabelText("输入你的故事创意"), {
			target: { value: "月台信号灯异常" },
		});
		fireEvent.click(screen.getByRole("button", { name: "开始创作" }));
		await waitFor(() =>
			expect(create).toHaveBeenCalledWith(
				expect.objectContaining({
					universe_id: 12,
					chapter_number: 5,
					chapter_title: "月台信号灯异常",
				}),
			),
		);
	});

	it("keeps the start button disabled until story text is entered", () => {
		renderHomePage();
		expect(screen.getByRole("button", { name: "开始创作" })).toBeDisabled();
	});

	it("shows remaining characters near the limit", () => {
		renderHomePage();
		fireEvent.change(screen.getByLabelText("输入你的故事创意"), {
			target: { value: "a".repeat(4600) },
		});
		expect(screen.getByText(/还可输入 400 字/)).toBeInTheDocument();
	});
});
