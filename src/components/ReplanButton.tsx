import { RotateCcw } from 'lucide-react'
import { api } from '@/lib/api'
import { act, useStore } from '@/store/app'
import { Button } from './ui'

/**
 * The plan stays put during the day: edits only refresh what sits in each block.
 * A full re-plan happens each morning, when preferences change, or with this button.
 */
export function ReplanButton() {
  const plan = useStore((s) => s.state!.plan)
  const at = new Date(plan.fullPlannedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-faint" title="Blocks keep their place until the next full re-plan (each morning, after a preference change, or when you click Re-plan). Adding or finishing tasks only changes what's inside them.">
        Planned {at}
      </span>
      <Button onClick={() => act(api.replan(), 'Re-planned: everything not pinned or started was rearranged')} title="Rearrange everything that isn't pinned or already started">
        <RotateCcw size={13} /> Re-plan
      </Button>
    </div>
  )
}
