/**
 * 任务描述的历史遗留清洗（P1·7.3，意见 N11）。
 *
 * 背景：早期由热点派生任务时，曾把溯源字段（热点来源 / 原文 / 关注域）**拼接进 description 正文**。
 * 该派生链路现已废弃（见 `daily-hot` 的「热点不派生任务」边界约束），但库中仍留有历史文本
 * （如任务 #7 的正文尾部三行）。
 *
 * 处理策略（用户定案）：**读取时清洗，不批量改库**——
 * - 不在迁移里 UPDATE 既有行，避免破坏历史数据与不可逆写入；
 * - 只在 API 返回前剥掉尾部这几行，用户看到的是干净正文；
 * - 溯源信息本身不丢失：仍由结构化的 `task_hot_refs`（任务背景 · 外部环境情报面板）承载。
 */

/** 匹配正文尾部的溯源机器字段行（可多行连续出现） */
const TRAILING_SOURCE_LINE =
  /^\s*(热点来源|原文|关注域|数据时间|证据等级)\s*[:：].*$/;

/**
 * 清洗任务描述：剥掉尾部的溯源机器字段行。
 * 只处理**末尾连续**的若干行，正文中间若出现形似文本不误伤。
 */
export function cleanTaskDescription(raw: string | null | undefined): string {
  const text = raw ?? '';
  if (!text) return '';
  const lines = text.split(/\r?\n/);
  // 从末尾往前吃掉属于溯源字段的空行与字段行
  let end = lines.length;
  while (end > 0) {
    const line = lines[end - 1];
    if (TRAILING_SOURCE_LINE.test(line) || line.trim() === '') {
      end -= 1;
      continue;
    }
    break;
  }
  // 整篇都是溯源字段时不返回空串（保留原文，避免把描述彻底清没）
  if (end === 0) return text.trim();
  return lines.slice(0, end).join('\n').trimEnd();
}
