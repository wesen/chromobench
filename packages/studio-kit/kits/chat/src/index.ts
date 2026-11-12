// @chromobench/studio-kit/kits/chat — the assistant chat (CHB-008). Headless; renderers are ./dom.ts.
export {
  createChatKit, chatServiceOf, MODES, EFFORT_LABELS,
  type ChatKit, type ChatService, type ChatProvider, type ChatSessionLike, type ChatStateView, type ChatItemView, type ChatLook, type ChatApproval, type ChatEffort,
} from './kit.ts';
