import type { RecordCategory } from '@/lib/categories';
import type { SaveRecordRequest } from '@/lib/records';

/** 一键直记动作描述：声明待写入载荷构建器、提示文案与防重入键，供看板与健康页共用。 */
export interface OneTapRecordAction<K extends string = string> {
  readonly key: K;
  readonly disabled?: boolean;
  readonly toastTitle: string;
  readonly undoToastTitle: string;
  readonly undoErrorFallback?: string;
  readonly buildRequest: (recordedAt: string) => SaveRecordRequest;
}

interface OneTapToastAction {
  readonly label: string;
  readonly onClick: () => void | Promise<void>;
}

interface OneTapToastOptions {
  readonly action?: OneTapToastAction;
}

interface OneTapToastPort {
  readonly success: (title: string, description?: string, options?: OneTapToastOptions) => unknown;
  readonly info: (title: string, description?: string, options?: OneTapToastOptions) => unknown;
  readonly error: (title: string, description?: string, options?: OneTapToastOptions) => unknown;
}

interface OneTapRecordPorts<K extends string> {
  readonly save: (req: SaveRecordRequest) => Promise<{ readonly id: number }>;
  readonly remove: (category: RecordCategory, id: number) => Promise<void>;
  readonly notify: OneTapToastPort;
  readonly now: () => Date;
  readonly formatTime: (iso: string) => string;
  readonly onBusyChange: (busyKey: K | null) => void;
}

const DEFAULT_SAVE_ERROR = '快捷记录失败，请稍后重试';
const DEFAULT_UNDO_ERROR = '请前往记录页手动删除。';

/**
 * 构建纯逻辑一键直记执行器（Ports & Adapters）：
 * 统一封装同步防重入锁、时间戳采样、写入与带单次执行守卫的撤销 Toast，
 * 避免多个页面重复实现竞态防护并支持不依赖 React/DOM 的进程内验证。
 */
export function createOneTapRecordRunner<K extends string = string>(ports: OneTapRecordPorts<K>) {
  // 同步防重入锁：在 UI 渲染出禁用态之前的同一帧内拦截高频连点，防止发出重复写入请求。
  let locked = false;

  async function trigger(action: OneTapRecordAction<K>): Promise<boolean> {
    if (locked || action.disabled) return false;
    locked = true;
    ports.onBusyChange(action.key);

    try {
      const recordedAt = ports.now().toISOString();
      const timeText = ports.formatTime(recordedAt);
      const request = action.buildRequest(recordedAt);
      const created = await ports.save(request);
      // 单次撤销守卫：防止用户在 Toast 消失前连续点击“撤销”，对已删除记录重复发 DELETE 误报 404。
      let undone = false;
      ports.notify.success(action.toastTitle, `记录时间 ${timeText}`, {
        action: {
          label: '撤销',
          onClick: async () => {
            if (undone) return;
            undone = true;
            try {
              await ports.remove(request.category, created.id);
              ports.notify.info(action.undoToastTitle);
            } catch (cause) {
              ports.notify.error(
                '撤销失败',
                cause instanceof Error ? cause.message : (action.undoErrorFallback ?? DEFAULT_UNDO_ERROR),
              );
            }
          },
        },
      });
      return true;
    } catch (cause) {
      ports.notify.error(cause instanceof Error ? cause.message : DEFAULT_SAVE_ERROR);
      return false;
    } finally {
      locked = false;
      ports.onBusyChange(null);
    }
  }

  return { trigger };
}
