type Listener = (msg: string, duration: number) => void;

let listener: Listener | null = null;

export function setToastListener(fn: Listener | null) {
  listener = fn;
}

/** 全局极简提示：底部淡入，默认 2s 自动消失 */
export function toast(msg: string, duration = 2100) {
  listener?.(msg, duration);
}
