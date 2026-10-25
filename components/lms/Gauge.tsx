// Semicircle tick gauge, from the original lead-management-sys.
const TICKS = 30

function round(n: number) {
  return Math.round(n * 1000) / 1000
}

export function Gauge({ percent, label }: { percent: number | null; label: string }) {
  const cx = 100
  const cy = 96
  const rOuter = 82
  const tickLen = 11

  const ticks = Array.from({ length: TICKS }, (_, i) => {
    const t = i / (TICKS - 1)
    const angle = ((180 + t * 180) * Math.PI) / 180
    return {
      key: i,
      x1: round(cx + (rOuter - tickLen) * Math.cos(angle)),
      y1: round(cy + (rOuter - tickLen) * Math.sin(angle)),
      x2: round(cx + rOuter * Math.cos(angle)),
      y2: round(cy + rOuter * Math.sin(angle)),
      filled: percent !== null && percent > 0 && t <= percent / 100,
    }
  })

  return (
    <div className="flex flex-col items-center" role="img" aria-label={`${label}: ${percent === null ? 'no data yet' : `${percent}%`}`}>
      <svg viewBox="0 0 200 108" className="h-[104px] w-[180px] max-w-full" aria-hidden>
        {ticks.map((t) => (
          <line
            key={t.key}
            x1={t.x1}
            y1={t.y1}
            x2={t.x2}
            y2={t.y2}
            strokeWidth={2.5}
            strokeLinecap="round"
            className={t.filled ? 'stroke-primary' : 'stroke-border'}
          />
        ))}
      </svg>
      <div className="-mt-9 flex flex-col items-center">
        <span className="text-[26px] font-semibold tabular-nums tracking-tight">{percent === null ? '—' : `${percent}%`}</span>
        <span className="text-[12px] text-muted-foreground">{label}</span>
      </div>
    </div>
  )
}
