// Claude Code (and presumably other CLIs with a similar skills/scratchpad
// mechanism) loads its own internal machinery through the exact same
// Read/tool-call plumbing as anything the user asked for — a skill's
// reference file, a background task's output file, a scratchpad path all
// show up in the transcript looking identical to a project file the user
// actually cares about. Flagging "you haven't touched
// /private/tmp/claude-501/bundled-skills/.../palette.md in 7 turns" is
// technically true and completely useless: it's not the user's file, they
// never consciously read it, and there's nothing for them to do about it.
//
// Real report from using this tool: exactly this happened on a live
// session (a dataviz skill reference flagged as "stale context"). Every
// heuristic that groups on `target` should skip a path matching this
// before ever producing a finding from it.
const INTERNAL_PATH_PATTERNS = [
  /\/(private\/)?tmp\/claude-\d+\//, // Claude Code's own per-session temp root (skills, scratchpad, task outputs)
  /\/bundled-skills\//,
];

export function isInternalPath(target: string): boolean {
  return INTERNAL_PATH_PATTERNS.some((pattern) => pattern.test(target));
}
