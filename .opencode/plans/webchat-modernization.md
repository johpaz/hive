# WebChat Modernization Plan - ChatGPT/Gemini/Kimi Style

## Current Problems

### 1. Rigid Layout
- `WebChatPage.tsx`: `max-w-4xl`, `mt-10`, `border-x` → looks like a boxed panel, not a modern full-screen chat
- `ChatContainer.tsx`: Bulky header with redundant user/agent info
- Messages constrained to `max-w-[72%]`

### 2. Fragile Streaming
- `"agent-streaming-id"` hardcoded fallback causes collisions (`ChatContainer.tsx:68`)
- Every chunk → full array replacement → full re-render
- useEffect resubscribes on every `addMessage`/`setLoading` change

### 3. No Session Persistence
- Single session per user (`sessionId = currentUser?.id || "default"`)
- No conversation switching
- Chat state lost on refresh
- No re-fetch on reconnect

### 4. No Narration/TTS
- Zero client-side TTS code
- No `SpeechSynthesis` integration
- Step narrations are visual-only text badges
- Agent audio requires manual click (no autoplay)

---

## Phase 1: Modern ChatGPT-like Layout

### `WebChatPage.tsx`
- Remove `max-w-4xl`, `mt-10`, `border-x border-white/5`
- Make the container full-height: `h-full bg-zinc-950 overflow-hidden`
- Let ChatContainer handle its own max-width constraints

### `ChatContainer.tsx`
- **Header**: Simplify to minimal - just agent name + connection status dot. Remove the user info section.
- **Messages area**: Full flex, proper padding, centered content with `max-w-3xl mx-auto`
- **Input**: Sticky at bottom with modern floating style
- **Connection status**: Inline minimal dot + text, not a full section

### `ChatHistory.tsx`
- **Empty state**: Make prompt suggestions clickable (onClick → send message)
- Better spacing and visual hierarchy
- Streaming text should appear alongside/replace the thinking dots

### `ChatMessage.tsx`
- Agent messages: `max-w-[80%]` 
- User messages: keep `max-w-[72%]`
- More breathing room between messages
- Subtle timestamps (always visible but muted, not hidden)

### `ChatInput.tsx`
- Floating pill design like ChatGPT (rounded, centered, with subtle shadow)
- Auto-resize textarea that grows
- Better disabled state
- Placeholder dynamic based on connection state

---

## Phase 2: Robust Streaming

### `chatStore.ts`
- Add `streamingMessageId: string | null` to state
- Add `setStreamingMessageId(id)` action
- Optimize `updateMessage` to use immer or selective updates

### `ChatContainer.tsx`
- Fix streaming ID: use `data.id || generateId()` instead of hardcoded `"agent-streaming-id"`
- Set `streamingMessageId` when first chunk arrives, clear on final chunk
- Reduce useEffect dependencies to avoid re-subscription gaps
- Use `useCallback` for handler functions to stabilize references

### New: `useChatStreaming.ts` hook
- Dedicated hook that manages streaming state
- Handles first chunk → create message, subsequent chunks → append
- Final chunk → clear streaming state
- Debounced scroll-to-bottom during streaming

### `ChatHistory.tsx`
- When `streamingMessageId` is set, render that message with a "streaming" visual indicator (subtle pulse border)
- Replace thinking dots with actual streaming text once chunks start arriving

---

## Phase 3: Persistent Session

### `chatStore.ts`
- Add Zustand `persist` middleware (localStorage)
- Persist `messages` and `currentSteps` 
- Don't persist `isLoading` or `streamingMessageId` (reset on reload)

### `useWebSocketStore.ts`
- Replace fixed 3s reconnect with exponential backoff (3s, 6s, 12s, max 30s)
- On reconnect: re-send `canvas_subscribe`, trigger re-fetch of history
- Add `reconnectAttempts` counter visible in UI

### `ChatContainer.tsx`
- On disconnect: show inline warning banner (not error message in chat)
- "Reconnecting..." with spinning indicator
- Auto-recover on reconnect: fetch new history and merge
- Add retry button for failed sends

### `useConversationManager.ts` (future foundation)
- Prepare store structure for multi-conversation support
- `createConversation()`, `listConversations()`, `switchConversation()`
- For now, keep single session but with proper state management

---

## Phase 4: Narration with Web Speech API

### New: `hooks/useNarration.ts`
- Uses `window.speechSynthesis` (Web Speech API)
- State: `isEnabled: boolean`, `isSpeaking: boolean`, `currentUtterance: string | null`
- `narrate(text: string)`: Creates `SpeechSynthesisUtterance`, speaks it
- `stop()`: Cancels current speech
- `toggle()`: Enable/disable narration
- Auto-persist `isEnabled` preference to localStorage
- Handle edge cases: pause on new message, resume, queue management

### `ChatContainer.tsx`
- Integrate `useNarration`
- On final agent message (non-chunk): if narration enabled, auto-narrate
- Add narration toggle button in header (speaker icon)
- When narration is active, show subtle "speaking" indicator

### `ChatMessage.tsx`
- Add per-message narration button (🔊 icon on hover)
- Visual feedback when message is being narrated (highlight border)
- Click to narrate individual messages

### `ChatHistory.tsx`
- Step narrations can also be narrated if enabled
- Show "speaking..." indicator on the thinking indicator when narrating steps

### Preferences
- Store `{ narrationEnabled: boolean, narrationRate: number, narrationPitch: number }` in localStorage
- Add settings accessible from chat header gear icon (minimal popover)
- Default: narration OFF (user must enable), rate 1.0, pitch 1.0

---

## Implementation Order

1. **WebChatPage.tsx** - Remove rigid layout constraints
2. **ChatContainer.tsx** - Modernize header, layout, add narration integration point
3. **ChatMessage.tsx** - Update widths, add narration button
4. **ChatHistory.tsx** - Clickable prompts, better empty state
5. **ChatInput.tsx** - Modern floating design
6. **chatStore.ts** - Add streamingMessageId, persist middleware
7. **ChatContainer.tsx** - Fix streaming, reduce resubscriptions
8. **useNarration.ts** - Create Web Speech API hook
9. **useWebSocketStore.ts** - Exponential backoff, reconnect improvements
10. **ChatContainer.tsx** - Inline disconnect warning, retry, narration integration