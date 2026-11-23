/**
 * サーバーから内容を読み、変化の知らせ（Server-Sent Events）が来たら読み直す。
 */
import { useEffect, useRef, useState } from "react";

/** 読み直しをまとめる間隔。続けて届いた知らせで、何度も読み直さない */
const REFRESH_DELAY_MS = 250;

type Listener = () => void;
const listeners = new Set<Listener>();
let source: EventSource | undefined;

function connect(): void {
  if (source) return;
  source = new EventSource("/api/events");
  const fire = () => {
    for (const l of [...listeners]) l();
  };
  source.addEventListener("changed", fire);
  // つながり直したときは、切れていた間の変化を読み直す
  source.addEventListener("open", fire);
  // 切れたことも伝える（読み直しが失敗して、接続できない表示になる）
  source.addEventListener("error", fire);
}

/** 変化の知らせを受け取る */
function subscribe(listener: Listener): () => void {
  connect();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export interface Live<T> {
  data: T | undefined;
  /** 最後の読み込みに失敗したか */
  offline: boolean;
}

/** path の内容を読み、変化の知らせのたびに読み直す */
export function useLive<T>(path: string): Live<T> {
  const [state, setState] = useState<Live<T>>({
    data: undefined,
    offline: false,
  });
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(path, {
          headers: { Accept: "application/json" },
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as T;
        if (!cancelled) setState({ data, offline: false });
      } catch {
        // 前に読めた内容は残したまま、接続できないことだけを伝える
        if (!cancelled) setState((s) => ({ data: s.data, offline: true }));
      }
    };
    void load();
    const unsubscribe = subscribe(() => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void load(), REFRESH_DELAY_MS);
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timer.current);
      unsubscribe();
    };
  }, [path]);

  return state;
}

/** 1 秒ごとに今の時刻を返す（経過時間や、次の確認までの秒数の表示用） */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(id);
    };
  }, []);
  return now;
}
