import type { SaveRecordRequest } from '@/lib/records';

export type CategoryBuildResult =
  | { readonly ok: false; readonly error: string }
  | {
      readonly ok: true;
      readonly request: SaveRecordRequest;
      readonly toastTitle: string;
      readonly toastDescription?: string;
    };
