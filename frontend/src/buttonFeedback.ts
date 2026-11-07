/** 全站按钮的轻量点击反馈：只绘制外侧光晕，不改文字、布局或业务事件。 */
export function installButtonFeedback(): () => void {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const animations = new Map<HTMLButtonElement, Animation>();

  const cancelAll = () => {
    for (const animation of animations.values()) animation.cancel();
    animations.clear();
  };

  const onClick = (event: MouseEvent) => {
    if (reducedMotion.matches || event.button !== 0 || !(event.target instanceof Element)) return;
    const button = event.target.closest('button');
    if (!(button instanceof HTMLButtonElement)
      || button.matches(':disabled, [aria-disabled="true"], .is-disabled, .is-loading')
      || button.closest('[inert]') || typeof button.animate !== 'function') return;

    // 捕获阶段也能覆盖弹窗和阻止冒泡的原件放大按钮；不拦截它们原有的点击处理。
    // 快速连点仅保留一次动画，完成后释放引用，避免产生叠加光晕。
    animations.get(button)?.cancel();
    const shadow = getComputedStyle(button).boxShadow;
    const base = shadow === 'none' ? '' : `${shadow}, `;
    const rgb = button.matches('.danger, .el-button--danger') ? '192, 69, 91' : '66, 133, 238';
    const animation = button.animate([
      { boxShadow: `${base}0 0 0 0 rgba(${rgb}, .3)` },
      { boxShadow: `${base}0 0 0 5px rgba(${rgb}, .12)`, offset: 0.55 },
      { boxShadow: `${base}0 0 0 8px rgba(${rgb}, 0)` },
    ], { duration: 420, easing: 'cubic-bezier(.16,1,.3,1)' });
    animations.set(button, animation);
    const release = () => {
      if (animations.get(button) === animation) animations.delete(button);
    };
    animation.onfinish = release;
    animation.oncancel = release;
  };

  // click 同时覆盖鼠标、触摸和 Enter/空格激活；尊重系统的减少动态效果设置。
  document.addEventListener('click', onClick, true);
  reducedMotion.addEventListener('change', cancelAll);
  return () => {
    document.removeEventListener('click', onClick, true);
    reducedMotion.removeEventListener('change', cancelAll);
    cancelAll();
  };
}
