/**
 * コマンドの出力先。テストでは差し替える。
 */
export interface Output {
  out: (text: string) => void;
  err: (text: string) => void;
}

export const consoleOutput: Output = {
  out: (text) => console.log(text),
  err: (text) => console.error(text),
};
