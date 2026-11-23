/**
 * 「何かが変わった」ことを、管理画面に知らせる窓口。
 * 何が変わったかは伝えない（画面は知らせを受けたら、今見ている内容を読み直す）。
 */
export type ChangeListener = () => void;

export class ChangeHub {
  private readonly listeners = new Set<ChangeListener>();

  /** 知らせを受け取る。返り値を呼ぶと、受け取るのをやめる */
  subscribe(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  notify(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        // 1 つの受け取り手の失敗で、ほかの知らせを止めない
      }
    }
  }

  get size(): number {
    return this.listeners.size;
  }
}
