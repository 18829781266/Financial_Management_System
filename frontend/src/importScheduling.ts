/** 导入任务在异步阶段边界检查取消，避免已取消批次继续追加行或占用文件资源。 */
export function checkImportAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('本次文件读取已取消', 'AbortError');
}

/** 给浏览器一次真正的任务切换机会，让进度、输入与取消按钮及时响应。 */
export function yieldImportTurn(signal?: AbortSignal): Promise<void> {
  checkImportAbort(signal);
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(new DOMException('本次文件读取已取消', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      try { checkImportAbort(signal); resolve(); } catch (error) { reject(error); }
    }, 0);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
