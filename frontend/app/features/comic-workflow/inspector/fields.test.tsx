import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Input } from "~/components/ui/Input";
import { ActionButton, FormShell, SaveButton } from "./fields";

describe("ActionButton", () => {
	it("renders a danger action as red text on a quiet background, never red on red", () => {
		render(<ActionButton icon="trash-2" label="删除" danger onClick={vi.fn()} />);
		const button = screen.getByRole("button", { name: "删除" });
		expect(button.className).toContain("text-error-fg");
		expect(button.className).not.toContain("bg-error ");
	});
});

describe("FormShell auto-save", () => {
	function Shell({ dirty, onAutoSave }: { dirty: boolean; onAutoSave: () => void }) {
		return (
			<>
				<FormShell disabled={false} dirty={dirty} onAutoSave={onAutoSave}>
					<Input label="名称" value="x" onChange={vi.fn()} />
					<SaveButton disabled={false} loading={false} onClick={vi.fn()} />
				</FormShell>
				<input aria-label="外部" />
			</>
		);
	}

	it("saves when focus leaves a dirty form, not when it moves inside", () => {
		const onAutoSave = vi.fn();
		render(<Shell dirty onAutoSave={onAutoSave} />);
		expect(screen.getByRole("status")).toHaveTextContent("未保存");
		fireEvent.focus(screen.getByLabelText("名称"));
		fireEvent.blur(screen.getByLabelText("名称"), {
			relatedTarget: screen.getByRole("button", { name: "保存" }),
		});
		expect(onAutoSave).not.toHaveBeenCalled();
		fireEvent.blur(screen.getByLabelText("名称"), { relatedTarget: screen.getByLabelText("外部") });
		expect(onAutoSave).toHaveBeenCalledTimes(1);
	});

	it("does nothing when the form is clean", () => {
		const onAutoSave = vi.fn();
		render(<Shell dirty={false} onAutoSave={onAutoSave} />);
		fireEvent.blur(screen.getByLabelText("名称"), { relatedTarget: null });
		expect(onAutoSave).not.toHaveBeenCalled();
		expect(screen.queryByRole("status")).toBeNull();
	});
});
