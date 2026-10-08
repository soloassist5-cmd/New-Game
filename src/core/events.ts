/** Minimal typed event bus. Simulation publishes, audio/render/UI subscribe. */
export class EventBus<M extends { [K in keyof M]: unknown }> {
  private handlers: { [K in keyof M]?: Array<(payload: M[K]) => void> } = {};

  on<K extends keyof M>(type: K, fn: (payload: M[K]) => void): () => void {
    const list = (this.handlers[type] ??= []);
    list.push(fn);
    return () => {
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    };
  }

  emit<K extends keyof M>(type: K, payload: M[K]): void {
    const list = this.handlers[type];
    if (!list) return;
    for (let i = 0; i < list.length; i++) list[i](payload);
  }

  clear(): void {
    this.handlers = {};
  }
}
