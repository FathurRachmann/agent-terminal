/** Shared mention suggest items — safe for renderer (no node:fs). */
export type MentionSuggestItem = {
  id: string;
  label: string;
  insert: string;
  kind: string;
  detail?: string;
};

export const STATIC_MENTION_SUGGESTS: MentionSuggestItem[] = [
  {
    id: "terminals",
    label: "@Terminals",
    insert: "@Terminals",
    kind: "terminals",
    detail: "Recent PTY / terminal output",
  },
  {
    id: "commit",
    label: "@Commit",
    insert: "@Commit",
    kind: "commit",
    detail: "Uncommitted working tree diff",
  },
  {
    id: "branch",
    label: "@Branch",
    insert: "@Branch",
    kind: "branch",
    detail: "Diff vs main/master",
  },
  {
    id: "chats",
    label: "@Chats",
    insert: "@Chats",
    kind: "chats",
    detail: "Prior chat transcript",
  },
  {
    id: "folders",
    label: "@Folders",
    insert: "@folder:",
    kind: "folder",
    detail: "Attach a folder listing — type path after",
  },
];
