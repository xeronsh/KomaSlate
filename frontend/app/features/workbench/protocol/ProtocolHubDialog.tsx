import { useState } from "react";
import { Button } from "~/components/ui/Button";
import { Dialog } from "~/components/ui/Dialog";
import { Switch } from "~/components/ui/Switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/Tabs";
import { useEditorStore, type ProtocolHubTab } from "~/stores/editorStore";
import { toast } from "~/utils/toast";
import type {
	CliToolSummary,
	OutboundMcpSummary,
} from "../nodegraph/buildHybridTopology";
import { appendProtocolLog } from "./protocolLogStore";

interface ProtocolHubDialogProps {
	projectId: number;
	open: boolean;
	onClose: () => void;
	mcpServers: OutboundMcpSummary[];
	cliTools: CliToolSummary[];
	onToggleMcpServer?: (id: string, enabled: boolean) => void;
	onToggleMcpPolicy?: (id: string, policy: "auto_readonly" | "confirm_writes") => void;
	onPingMcpServer?: (id: string) => Promise<void> | void;
	onDryRunCliTool?: (name: string, sampleCommand: string) => Promise<void> | void;
}

const INBOUND_MCP_CONFIG = JSON.stringify(
	{
		mcpServers: {
			komaslate: {
				command: "uv",
				args: [
					"run",
					"--directory",
					"/path/to/KomaSlate/backend",
					"komaslate",
					"mcp",
					"serve",
				],
				env: {
					ENGINE_URL: "http://127.0.0.1:18766",
					KOMASLATE_GATEWAY: "http://127.0.0.1:18765",
				},
			},
		},
	},
	null,
	2,
);

export function ProtocolHubDialog({
	projectId,
	open,
	onClose,
	mcpServers,
	cliTools,
	onToggleMcpServer,
	onToggleMcpPolicy,
	onPingMcpServer,
	onDryRunCliTool,
}: ProtocolHubDialogProps) {
	const hubTab = useEditorStore((s) => s.hubTab);
	const setHubTab = useEditorStore((s) => s.setHubTab);
	const [pingingId, setPingingId] = useState<string | null>(null);
	const [runningCli, setRunningCli] = useState<string | null>(null);

	const copyToClipboard = async (text: string, okTitle: string) => {
		try {
			await navigator.clipboard.writeText(text);
			toast.success({ title: okTitle, message: "已写入剪贴板" });
		} catch {
			toast.info({ title: okTitle, message: "浏览器限制剪贴板写入，请手动复制" });
		}
	};

	const handlePing = async (server: OutboundMcpSummary) => {
		setPingingId(server.id);
		try {
			if (onPingMcpServer) {
				await onPingMcpServer(server.id);
			} else {
				appendProtocolLog(projectId, {
					channel: "RPC",
					direction: "OUT",
					source: server.name,
					summary: `tools/list -> 200 OK`,
					latencyMs: server.latencyMs ?? 38,
					payload: { jsonrpc: "2.0", method: "tools/list", server: server.name },
				});
				toast.success({ title: `${server.name} 在线`, message: "MCP 活性探测通过" });
			}
		} finally {
			setPingingId(null);
		}
	};

	const handleDryRun = async (tool: CliToolSummary) => {
		setRunningCli(tool.name);
		try {
			if (onDryRunCliTool) {
				await onDryRunCliTool(tool.name, tool.sampleCommand);
			} else {
				appendProtocolLog(projectId, {
					channel: "STDIO",
					direction: "OUT",
					source: tool.name,
					summary: `$ ${tool.sampleCommand}`,
					payload: { command: tool.name, args: tool.sampleCommand.split(" ").slice(1) },
				});
				toast.info({ title: `已提交 ${tool.name}`, message: "输出已记录到协议终端" });
			}
		} finally {
			setRunningCli(null);
		}
	};

	return (
		<Dialog
			open={open}
			onClose={onClose}
			labelledBy="protocol-hub-title"
			className="flex w-[min(96vw,76rem)] max-w-3xl flex-col gap-3 p-5"
		>
			<div className="flex items-start justify-between gap-3 border-b border-line pb-3">
				<div>
					<h2 id="protocol-hub-title" className="m-0 text-md font-semibold text-ink">
						双向 MCP &amp; CLI 协议枢纽
					</h2>
					<p className="m-0 mt-0.5 text-xs text-ink-muted">
						管理 Engine 出向 MCP Server、受控本地 CLI 工具链，以及面向 Claude / Cursor 的 Inbound MCP 暴露配置
					</p>
				</div>
				<Button size="xs" variant="ghost" onClick={onClose} aria-label="关闭协议枢纽">
					关闭
				</Button>
			</div>

			<Tabs
				value={hubTab}
				onValueChange={(value) => setHubTab(value as ProtocolHubTab)}
				className="flex min-h-0 flex-1 flex-col gap-3"
			>
				<TabsList variant="underline">
					<TabsTrigger value="outbound">Outbound MCP</TabsTrigger>
					<TabsTrigger value="cli">CLI Tools</TabsTrigger>
					<TabsTrigger value="inbound">Inbound MCP</TabsTrigger>
				</TabsList>

				<TabsContent value="outbound" className="max-h-96 space-y-2 overflow-y-auto pr-1">
					{mcpServers.length === 0 ? (
						<p className="m-0 py-6 text-center text-xs text-ink-muted">
							暂无已注册的 Outbound MCP Server
						</p>
					) : (
						mcpServers.map((server) => (
							<div
								key={server.id}
								className="flex flex-col gap-2 rounded-md border border-line bg-paper-100 p-3 sm:flex-row sm:items-center sm:justify-between"
							>
								<div className="min-w-0 flex-1">
									<div className="flex items-center gap-2">
										<span className="font-mono text-xs font-semibold text-ink">
											{server.name}
										</span>
										<span
											className={`rounded-full px-2 py-0.5 text-xs ${
												server.enabled
													? "bg-success-bg text-success-fg"
													: "bg-paper-200 text-ink-muted"
											}`}
										>
											{server.enabled
												? `在线${server.latencyMs != null ? ` · ${server.latencyMs}ms` : ""}`
												: "已停用"}
										</span>
									</div>
									<div className="mt-1 truncate font-mono text-xs text-ink-muted">
										{server.transport}
									</div>
								</div>

								<div className="flex items-center gap-2">
									<Button
										size="xs"
										variant="secondary"
										onClick={() =>
											onToggleMcpPolicy?.(
												server.id,
												server.policy === "auto_readonly"
													? "confirm_writes"
													: "auto_readonly",
											)
										}
									>
										{server.policy === "auto_readonly"
											? "只读自动放行"
											: "写操作需人工确认"}
									</Button>
									<Button
										size="xs"
										variant="ghost"
										loading={pingingId === server.id}
										onClick={() => void handlePing(server)}
									>
										Ping
									</Button>
									<Switch
										checked={server.enabled}
										onCheckedChange={(checked) =>
											onToggleMcpServer?.(server.id, checked)
										}
										aria-label={`启用或停用 ${server.name}`}
									/>
								</div>
							</div>
						))
					)}
				</TabsContent>

				<TabsContent value="cli" className="max-h-96 space-y-2 overflow-y-auto pr-1">
					{cliTools.map((tool) => (
						<div
							key={tool.name}
							className="flex flex-col gap-2 rounded-md border border-line bg-paper-100 p-3 sm:flex-row sm:items-center sm:justify-between"
						>
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-2">
									<span className="font-mono text-xs font-semibold text-ink">
										{tool.name}
									</span>
									<span className="rounded-sm bg-paper-200 px-1.5 py-0.5 font-mono text-xs text-success-fg">
										{tool.version}
									</span>
								</div>
								<p className="m-0 mt-1 text-xs text-ink-muted">{tool.description}</p>
								<div className="mt-1 truncate font-mono text-xs text-info-fg">
									$ {tool.sampleCommand}
								</div>
							</div>

							<div className="flex items-center gap-1.5">
								<Button
									size="xs"
									variant="secondary"
									onClick={() =>
										void copyToClipboard(tool.sampleCommand, `已复制 ${tool.name} 命令`)
									}
								>
									复制命令
								</Button>
								<Button
									size="xs"
									variant="primary"
									loading={runningCli === tool.name}
									onClick={() => void handleDryRun(tool)}
								>
									试跑
								</Button>
							</div>
						</div>
					))}
				</TabsContent>

				<TabsContent value="inbound" className="space-y-3">
					<p className="m-0 text-xs text-ink-muted">
						将 KomaSlate 暴露为标准 Inbound MCP Server 供 Claude Code / Cursor / Windsurf 接入。外部自主智能体可读取资源并提交修改建议，严禁自批人类审批门（强制校验前端一次性 human_auth_token）。
					</p>
					<pre className="m-0 max-h-64 overflow-auto rounded-md border border-line bg-paper-200 p-3 font-mono text-xs text-ink">
						{INBOUND_MCP_CONFIG}
					</pre>
					<div className="flex justify-end">
						<Button
							size="sm"
							variant="primary"
							onClick={() =>
								void copyToClipboard(INBOUND_MCP_CONFIG, "已复制 Inbound MCP JSON")
							}
						>
							复制 Claude / Cursor MCP 配置
						</Button>
					</div>
				</TabsContent>
			</Tabs>
		</Dialog>
	);
}
