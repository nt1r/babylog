import { useLayoutEffect, useRef, useState } from 'react';
import { toast } from '@/components/ui/toast';
import { createOneTapRecordRunner } from '@/lib/one-tap-record';
import { useDeleteRecordMutation, useSaveRecordMutation } from '@/lib/records';
import { formatLocalTimeFromISO } from '@/lib/time';

/**
 * 一键直记与单次撤销 Hook：将日常记录读写 Mutation、Toast 与时间格式化适配至纯逻辑执行器，
 * 对外仅暴露当前提交中的 busyKey 与稳定的 trigger 触发函数。
 */
export function useOneTapRecord<K extends string = string>() {
  const saveMutation = useSaveRecordMutation();
  const deleteMutation = useDeleteRecordMutation();
  const [busyKey, setBusyKey] = useState<K | null>(null);

  // 通过 useLayoutEffect 同步最新 mutation 回调，避免渲染期写 Ref 并保持执行器内同步防重入锁跨渲染稳定。
  const saveRef = useRef(saveMutation.mutateAsync);
  const deleteRef = useRef(deleteMutation.mutateAsync);
  useLayoutEffect(() => {
    saveRef.current = saveMutation.mutateAsync;
    deleteRef.current = deleteMutation.mutateAsync;
  }, [saveMutation.mutateAsync, deleteMutation.mutateAsync]);

  const [runner] = useState(() =>
    createOneTapRecordRunner<K>({
      save: (req) => saveRef.current(req),
      remove: (category, id) => deleteRef.current({ category, id }),
      notify: toast,
      now: () => new Date(),
      formatTime: formatLocalTimeFromISO,
      onBusyChange: setBusyKey,
    }),
  );

  return { busyKey, trigger: runner.trigger };
}
