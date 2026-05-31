/**
 * F157: Receipt Ack — receipt text word bank.
 * Neutral receipt lines shown as placeholder text in streaming cards.
 */
const RECEIPT_LINES = [
  '收到，马上处理。',
  '正在处理，稍等...',
  '已收到，开始分析。',
  '收到啦，这就去办。',
  '好的，正在思考。',
  '看到了，稍等一下。',
  '收到，正在处理中。',
  '已收到，马上安排。',
  '好的，这就去看看。',
  '收到，正在分析中。',
]

/**
 * Pick a random receipt line.
 */
export function pickReceiptLine(_catId?: string): string {
  return RECEIPT_LINES[Math.floor(Math.random() * RECEIPT_LINES.length)]
}
