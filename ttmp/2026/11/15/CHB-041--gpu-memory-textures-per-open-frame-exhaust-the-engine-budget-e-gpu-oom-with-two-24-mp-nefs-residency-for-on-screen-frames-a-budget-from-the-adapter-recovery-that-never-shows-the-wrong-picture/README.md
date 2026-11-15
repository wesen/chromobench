# GPU memory: textures per open frame exhaust the engine budget (E_GPU_OOM with two 24 MP NEFs); residency for on-screen frames, a budget from the adapter, recovery that never shows the wrong picture

This is the document workspace for ticket CHB-041.

## Structure

- **design/**: Design documents and architecture notes
- **reference/**: Reference documentation and API contracts
- **playbooks/**: Operational playbooks and procedures
- **scripts/**: Utility scripts and automation
- **sources/**: External sources and imported documents
- **various/**: Scratch or meeting notes, working notes
- **archive/**: Optional space for deprecated or reference-only artifacts

## Getting Started

Use docmgr commands to manage this workspace:

- Add documents: `docmgr doc add --ticket CHB-041 --doc-type design-doc --title "My Design"`
- Import sources: `docmgr import file --ticket CHB-041 --file /path/to/doc.md`
- Update metadata: `docmgr meta update --ticket CHB-041 --field Status --value review`
