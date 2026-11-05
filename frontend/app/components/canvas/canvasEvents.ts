// 事件类型定义 — 只保留仍在使用的事件
export interface CanvasEvents {
  "preview-image": { src: string; alt: string };
  "preview-video": { src: string; title: string };
  "select-workflow-node": { nodeId: string };
  /** 命令面板：选中某张卡片并把画布移过去 */
  "focus-workflow-node": { nodeId: string };
  /** 从画布导航栏唤起命令面板（⌘/Ctrl+K） */
  "open-command-palette": Record<string, never>;
  /** PromptBar 移除选区 chip → 画布同步选区 */
  "set-workflow-selection": { nodeIds: string[] };
  /** 不带实体时打开项目级版本对比。 */
  "version-history": { entityType?: "character" | "shot"; entityId?: number };
  /**
   * 成片卡「重新合成」→ ProjectPage 复用生成/恢复通路。
   * mode=recompose：分镜视频都在，只重新配音拼接，不重跑整条流水线。
   */
  "request-regenerate": { source: "output-card"; mode?: "recompose" };
}

type EventCallback<T> = (data: T) => void;
type AnyEventCallback = (data: CanvasEvents[keyof CanvasEvents]) => void;

// 事件总线单例
class CanvasEventBus {
  private listeners: Partial<Record<keyof CanvasEvents, Set<AnyEventCallback>>> = {};

  on<K extends keyof CanvasEvents>(
    event: K,
    callback: EventCallback<CanvasEvents[K]>
  ): () => void {
    if (!this.listeners[event]) {
      this.listeners[event] = new Set();
    }
    this.listeners[event].add(callback as EventCallback<CanvasEvents[keyof CanvasEvents]>);

    // 返回取消订阅函数
    return () => {
      this.listeners[event]?.delete(callback as EventCallback<CanvasEvents[keyof CanvasEvents]>);
    };
  }

  emit<K extends keyof CanvasEvents>(event: K, data: CanvasEvents[K]): void {
    const callbacks = this.listeners[event];
    if (callbacks) {
      callbacks.forEach((callback) => {
        callback(data);
      });
    }
  }

  off<K extends keyof CanvasEvents>(
    event: K,
    callback?: EventCallback<CanvasEvents[K]>
  ): void {
    if (callback) {
      this.listeners[event]?.delete(callback as EventCallback<CanvasEvents[keyof CanvasEvents]>);
    } else {
      delete this.listeners[event];
    }
  }

  clear(): void {
    this.listeners = {};
  }
}

export const canvasEvents = new CanvasEventBus();
