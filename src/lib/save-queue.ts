type PendingSave = { url: string; body: Record<string, unknown> };
export class SaveQueue {
  private pending = new Map<string, PendingSave>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  constructor(
    private send: (url: string, body: Record<string, unknown>) => Promise<void>,
    private onState: (state: "saved" | "saving" | "error") => void,
    private delay = 650,
  ) {}
  schedule(key: string, url: string, body: Record<string, unknown>) {
    this.pending.set(key, { url, body });
    this.onState("saving");
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flush().catch(() => undefined);
    }, this.delay);
  }
  hasPending() {
    return this.pending.size > 0 || !!this.running;
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.running) {
      await this.running;
      if (this.pending.size) await this.flush();
      return;
    }
    const work = async () => {
      while (this.pending.size) {
        const [key, save] = this.pending.entries().next().value!;
        try {
          await this.send(save.url, save.body);
        } catch (error) {
          this.onState("error");
          throw error;
        }
        if (this.pending.get(key) === save) this.pending.delete(key);
      }
      this.onState("saved");
    };
    this.running = work();
    try {
      await this.running;
    } finally {
      this.running = undefined;
    }
  }
  dispose() {
    clearTimeout(this.timer);
  }
  discard() {
    if (this.running) throw new Error("Cannot discard an in-flight save");
    clearTimeout(this.timer);
    this.pending.clear();
    this.onState("saved");
  }
}
