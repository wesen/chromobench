#!/usr/bin/env bash
# seed-diary.sh <ticket-id> <agent-output-file> <pair-description> <commit-note>
set -euo pipefail
tid=$1; out=$2; pair=$3; note=$4
diary=$(ls ttmp/2026/11/11/${tid}--*/diary/01-diary.md)
guide=$(ls ttmp/2026/11/11/${tid}--*/design-doc/01-intern-guide-*.md)
summary=$(sed -n '1,/^=====BEGIN/p' "$out" | sed '$d' | sed 's/^/> /')
words=$(python3 -I -c 'import sys;t=open(sys.argv[1]).read();print(len(t.split("\n---\n",1)[1].split()))' "$guide")
ntasks=$(grep -c '^- \[ \]' ttmp/2026/11/11/${tid}--*/tasks.md || true)
cat >> "$diary" <<ENTRY

# Diary

## Step 1: Intern guide written and filed

The intern guide for this ticket was drafted by a writer subagent working on ${pair}. The writer followed the shared brief and the CHB-001 architecture doc. The orchestrator filed the returned text into \`design-doc/$(basename "$guide")\` (${words} words), added ${ntasks} staged tasks, and related the primary source files.

### Prompt Context
**User prompt (verbatim):** "k, create the docmgr ticket, and for each ticket, Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable. commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)"
**Assistant interpretation:** Requested milestone: a complete intern guide plus a task breakdown for this ticket.
**Inferred user intent:** The ticket can be picked up by a new engineer or agent without prior context.

### Evidence and commits
- Brief: \`/tmp/claude-1000/-home-manuel-code-wesen-chromobench/456e1eb2-3441-4838-97c3-8a0b840b8e62/scratchpad/guide-brief-common.md\` (session scratchpad); shared map: CHB-001 \`design-doc/01-chromobench-architecture-and-work-plan.md\`.
- Filed with \`python3 -I CHB-001/scripts/07-ingest-intern-guides.py <agent output> .\` and checked with \`scripts/08-check-guide-markdown.py\` (fences tagged, no raw HTML).
- ${note}
- The writer's own summary, kept as returned:

${summary}

### Noteworthy decisions or failures
- The guide's "Proposed contract additions (for CHB-002)" section, where present, is a proposal. It must be reconciled with CHB-002 before implementation.
- Numbers the writer computed for the guide (not from the textbook) are labelled as such in the guide. They are not independently re-verified here.

### Remaining requirements and next action
- Implementation has not started. Tasks in \`tasks.md\` are open.
- Next: review the guide, settle the open decisions it lists, and start stage 1.
ENTRY
echo "seeded $tid"
