export type Ping = { type: 'ping'; from: 'extension' | 'desktop' }
export type Pong = { type: 'pong'; ts: number }
export type Msg = Ping | Pong

export function parseMsg(raw: string): Msg | null {
  try { return JSON.parse(raw) as Msg } catch { return null }
}
