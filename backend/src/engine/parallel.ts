/**
 * 并行子任务调度：按渠道分组、组间并行、组内串行、渠道级并发上限、失败不阻塞
 * （design.md D7 / tasks 2.6）
 */
export interface ParallelItem {
  id: string;
  channel: string;
}

export interface ParallelResult<T> {
  item: ParallelItem;
  ok: boolean;
  value?: T;
  error?: string;
}

/**
 * 执行并行分组任务。
 * @param groups 分组列表（同 channel 组内串行）
 * @param worker  单条子任务执行函数（返回 Promise）
 */
export async function runParallelGroups<T>(
  groups: { channel: string; items: string[] }[],
  worker: (itemId: string, channel: string) => Promise<T>,
  onEach?: (itemId: string, ok: boolean, value?: T, error?: string) => void,
): Promise<ParallelResult<T>[]> {
  const results: ParallelResult<T>[] = [];

  // 组间并行（不同渠道同时跑），组内串行（同渠道逐个跑）
  await Promise.all(
    groups.map(async (group) => {
      for (const itemId of group.items) {
        try {
          const value = await worker(itemId, group.channel);
          results.push({ item: { id: itemId, channel: group.channel }, ok: true, value });
          onEach?.(itemId, true, value);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          results.push({ item: { id: itemId, channel: group.channel }, ok: false, error: message });
          onEach?.(itemId, false, undefined, message);
          // 失败不阻塞其余子任务
        }
      }
    }),
  );

  return results;
}

/** 汇总失败清单 */
export function summarizeFailures<T>(results: ParallelResult<T>[]): { id: string; error: string }[] {
  return results.filter((r) => !r.ok).map((r) => ({ id: r.item.id, error: r.error ?? 'unknown' }));
}
