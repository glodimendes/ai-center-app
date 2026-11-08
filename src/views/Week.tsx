import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, CloudUpload } from 'lucide-react'
import { addDays, isoDate, isoWeek, parseDate, weekStart } from '@shared/time'
import { api } from '@/lib/api'
import { act, useStore } from '@/store/app'
import { gridItems, pinForTask, pinFromBlock } from '@/lib/plan'
import { TimeGrid } from '@/components/TimeGrid'
import { BlockPanel } from '@/components/BlockPanel'
import { BudgetBars } from '@/components/BudgetBars'
import { SyncDialog } from '@/components/SyncDialog'
import { Button, Header } from '@/components/ui'

export function Week() {
  const { state, day, setDay, selectedBlockId, selectBlock, go } = useStore()
  const s = state!
  const [sync, setSync] = useState(false)
  const start = weekStart(parseDate(day))
  const days = Array.from({ length: 7 }, (_, i) => isoDate(addDays(start, i)))
  const { items, allDay } = useMemo(() => gridItems(s, days), [s, day]) // eslint-disable-line react-hooks/exhaustive-deps
  const week = isoWeek(start)
  const warnings = s.plan.warnings.filter((w) => w.kind !== 'unscheduled')

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <Header
        title={`Week ${week.split('-W')[1]}`}
        sub={`${start.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${addDays(start, 6).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`}
      >
        <Button onClick={() => setDay(isoDate(addDays(start, -7)))}>
          <ChevronLeft size={14} />
        </Button>
        <Button onClick={() => setDay(isoDate(new Date()))}>This week</Button>
        <Button onClick={() => setDay(isoDate(addDays(start, 7)))}>
          <ChevronRight size={14} />
        </Button>
        <Button kind="primary" onClick={() => setSync(true)} disabled={!s.calendar.connected} title={s.calendar.connected ? 'Review and push planned blocks' : 'Connect Google Calendar in Settings'}>
          <CloudUpload size={13} /> Sync to calendar
        </Button>
      </Header>

      <div className="border-b border-line px-5 py-3 flex gap-6 items-start">
        <BudgetBars week={week} />
        {warnings.length > 0 && (
          <div className="flex-1 max-h-24 overflow-y-auto text-[11.5px] text-warn">
            {warnings.slice(0, 20).map((w, i) => (
              <div key={i} className="flex gap-1.5">
                <AlertTriangle size={11} className="mt-0.5 shrink-0" /> {w.message}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 flex">
        <TimeGrid
          days={days}
          items={items}
          allDay={allDay}
          selectedId={selectedBlockId}
          onSelect={selectBlock}
          onDayClick={(d) => (setDay(d), go('today'))}
          onMove={async (id, st, en) => {
            const b = s.plan.blocks.find((x) => x.id === id)
            if (b) await act(api.pin(pinFromBlock(b, st, en)))
          }}
          onDropTask={async (taskId, st) => {
            const pin = pinForTask(s, taskId, st)
            if (pin) await act(api.pin(pin))
          }}
        />
        <BlockPanel />
      </div>
      {sync && <SyncDialog onClose={() => setSync(false)} />}
    </div>
  )
}
