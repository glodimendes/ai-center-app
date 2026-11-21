import type { AgentDef } from '@shared/agents'

/** Agents the user can add from the Agents view. They are ordinary definition files once added, and can be edited or deleted. */
export interface Sample {
  def: AgentDef
  /** What must exist before it is useful (shown next to the button). */
  needs?: string
}

const base = { sources: [], triggers: ['manual'] }

export const SAMPLES: Sample[] = [
  {
    def: {
      ...base,
      id: 'coordinator',
      name: 'Coordinator',
      profile: 'claude',
      permission: 'read',
      output: 'reply',
      description: 'Splits a request between your other agents and writes the final answer. The Central chat uses it when you don\'t tag anyone.',
      instructions: `You are a careful project coordinator. Break the goal into the smallest useful steps, delegate each step to the agent whose description fits best, check what comes back, and only then write the final answer. Prefer a few well-specified delegations over many vague ones. If no agent fits a step, say so in the final answer instead of guessing.`
    }
  },
  {
    def: {
      ...base,
      id: 'task-automation',
      name: 'Task automation',
      profile: 'claude',
      permission: 'read',
      output: 'actions',
      description: 'Reads your open tasks and suggests which ones an agent could do or prepare; Accept hands the heavy part to an agent for review.',
      instructions: `Read 05_Tasks/daily-todos.md (the open tasks). Find at most 5 tasks where an AI agent could do or prepare the heavy part (research, a first draft, summarising, collecting data, drafting an email), and skip anything that needs the user's own judgement or presence.

For each one, propose an action of kind "run-agent" with payload {"agent": "<id of an existing custom agent that fits, or a new agent>", "input": "<a precise instruction including the task text verbatim>"}. If no existing agent fits, propose a "new-agent" action instead with payload {"id": "kebab-id", "name": "...", "permission": "read" or "propose", "output": "reply" or "file", "instructions": "...", "triggers": ["manual"]}.

If the task repeats (a repeat: token, or "every week"), also propose a "new-agent" action whose triggers contain "schedule: HH:MM" so it becomes a recurring agent.

Keep the task text in its original language. In your answer, give one line per suggestion explaining why it suits automation.`
    }
  },
  {
    def: {
      ...base,
      id: 'routine-coach',
      name: 'Routine coach',
      profile: 'claude',
      permission: 'read',
      output: 'actions',
      description: 'Example: tell it which routine to look after (training, study, a language…); it reads your notes and tasks and proposes the next steps as tasks.',
      instructions: `You look after one of my routines. The routine is named in my message for this run (for example "training" or "Spanish practice"); if it isn't, ask me which one in your answer and propose nothing.

Find what I have written about it: search the vault's notes and the task list (05_Tasks/daily-todos.md) for that routine, and read the newest weekly files in 05_Tasks/weekly/ to see what I actually did. Any data sources given below are extra evidence. Do not invent facts about what I did.

Judge consistency and load from what is written, then propose the next 3 to 5 steps. Each is an "add-task" action with payload {"section": ["<the heading where that routine's tasks live>"], "body": "<task line in my existing style, with an estimate like ~1h and a due: date if useful>"}. Match the language and format of the existing tasks.

In your answer, give a short reasoning (at most 6 lines): what the recent weeks show, why these steps, and what data you are missing.`
    }
  },
  {
    def: {
      ...base,
      id: 'email-triage',
      name: 'Email triage',
      profile: 'claude',
      permission: 'read',
      output: 'actions',
      sources: ['gmail-inbox'],
      description: 'Reads recent email from a Gmail source and proposes tasks and reply drafts. Never sends anything.',
      instructions: `The data below is my recent email (a Gmail source). Triage it: what needs my reply, what is a deadline or request I must track, and what can be ignored.

For each item that needs action, propose an "add-task" action with payload {"section": ["Inbox"], "body": "<short task, with due: date if the mail states one>"}. For mails that need a reply, also propose an "email-draft" action with payload {"to": "...", "subject": "...", "body": "<draft in the mail's language>"}; a draft is only ever saved as a draft for me to send myself.

In your answer, list the mails you ignored in one line each, so I can check your judgement.`
    },
    needs: 'a Gmail source with id gmail-inbox (Settings → Data sources → Connect Gmail → Add Gmail source)'
  }
]
