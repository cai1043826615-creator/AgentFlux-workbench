/**
 * 沙盒模式判定（作品集演示用）
 *
 * 为什么单独抽一个文件：
 *   「沙盒」会改变部分界面的**措辞**（而不是逻辑）——例如审批提示原本承诺
 *   「全部采纳后自动进入下一阶段」，但沙盒里没有真实 AI 接续产出、采纳不会推进阶段，
 *   文案必须跟着换口径，否则会出现「文案说会推进、实际不动」的自相矛盾。
 *   这类判定散落在各组件里容易漏改（历史教训：改了一处、漏了另一处分支），
 *   故集中在这里，全站统一取用。
 *
 * 判定依据：拦截层安装成功后会挂 `window.__SANDBOX__`（见 sandbox/mock-api.ts）。
 * 非沙盒环境（正常开发/生产使用）恒为 false，行为与文案完全不变。
 */
export function isSandboxMode(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean((window as unknown as { __SANDBOX__?: unknown }).__SANDBOX__);
}
