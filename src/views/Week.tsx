import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, CloudUpload } from 'lucide-react'
import { addDays, isoDate, isoWeek, parseDate, weekStart } from '@shared/time'
import { api } from '@/lib/api'
import { act, useStore } from '@/store/app'
import { gridItems, moveEvent, pinForTask, pinFromBlock } from '@/lib/plan'
import { TimeGrid } from '@/components/TimeGrid'
import { BlockPanel } from '@/components/BlockPanel'
import { BudgetBars } from '@/components/BudgetBars'
import { SyncDialog } from '@/components/SyncDialog'
import { ReplanButton } from '@/components/ReplanButton'
import { CalendarFilter } from '@/components/CalendarFilter'
import { AddBlockButton, NewBlockDialog, type BlockDraft } from '@/components/NewBlock'
import { Button, Header } from '@/components/ui'

export function Week() {
  const { state, day, setDay, selectedBlockId, selectBlock, go } = useStore()
  const s = state!
  const [sync, setSync] = useState(false)
  const [draft, setDraft] = useState<BlockDraft | null>(null)
  const start = weekStart(parseDate(day))
  const days = Array.from({ length: 7 }, (_, i) => isoDate(addDays(start, i)))
  const { items, allDay } = useMemo(() => gridItems(s, days), [s, day]) // eslint-disable-line react-hooks/exhaustive-deps
  const week = isoWeek(start)
  const warnings = s.plan.warnings

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <Header
        title={`Week ${week.split('-W')[1]}`}
        sub={`${start.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${addDays(start, 6).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`}
      >
        <AddBlockButton day={days.includes(isoDate(new Date())) ? isoDate(new Date()) : days[0]} onOpen={setDraft} />
        <ReplanButton />
        <CalendarFilter />
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
          <button onClick={() => go('alerts')} className="ml-auto flex items-center gap-1.5 text-[12px] text-warn hover:underline">
            <AlertTriangle size={12} /> {warnings.length} alert{warnings.length > 1 ? 's' : ''}: view and fix
          </button>
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
          onCreate={(start, end) => setDraft({ start, end })}
          onMove={async (id, st, en) => {
            if (await moveEvent(s, id, st, en)) return
            const b = s.plan.blocks.find((x) => x.id === id)
            if (b) await act(api.pin(pinFromBlock(b, st, en)))
          }}
          onDropTaskOnBlock={(taskId, blockId) => act(api.addTaskToBlock(blockId, taskId), 'Added to block')}
          onDropTask={async (taskId, st) => {
            const pin = pinForTask(s, taskId, st)
            if (pin) await act(api.pin(pin))
          }}
        />
        <BlockPanel />
      </div>
      {sync && <SyncDialog onClose={() => setSync(false)} />}
      {draft && <NewBlockDialog draft={draft} onClose={() => setDraft(null)} />}
    </div>
  )
}
