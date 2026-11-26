import type { SaveRecordRequest } from '@/lib/records';

/** 各品类快捷记录 codec 共享的表单校验与提交载荷构建结果。 */
export type CategoryBuildResult =
  | { readonly ok: false; readonly error: string }
  | {
      readonly ok: true;
      readonly request: SaveRecordRequest;
      readonly toastTitle: string;
      readonly toastDescription?: string;
    };
