import type { ChatMessage } from "@contracts";
import { type ReactNode, useEffect, useRef } from "react";
import { AlertIcon } from "../components/Icons";
import { formatFull, formatTime } from "../lib/labels";

function Stamp({ message, className }: { message: ChatMessage; className: string }) {
  return (
    <time
      dateTime={message.createdAt}
      title={formatFull(message.createdAt)}
      className={`mt-1 block text-[11px] ${className}`}
    >
      {formatTime(message.createdAt)}
    </time>
  );
}

function Bubble({ message }: { message: ChatMessage }) {
  if (message.role === "system") {
    return (
      <div
        role="alert"
        className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-900"
      >
        <AlertIcon className="mt-0.5 size-5 shrink-0" />
        <div>
          <p className="font-semibold">Important</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm">{message.content}</p>
        </div>
      </div>
    );
  }
  const mine = message.role === "patient";
  return (
    <div
      className={
        mine
          ? "ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-brand-600 px-4 py-2.5 text-white"
          : "mr-auto max-w-[85%] rounded-2xl rounded-bl-md border border-slate-200 bg-white px-4 py-2.5"
      }
    >
      <p className="sr-only">{mine ? "You:" : "Assistant:"}</p>
      <p className="whitespace-pre-wrap break-words">{message.content}</p>
      <Stamp message={message} className={mine ? "text-brand-50" : "text-slate-600"} />
    </div>
  );
}

function TypingIndicator() {
  return (
    <div
      role="status"
      aria-label="The assistant is typing"
      className="mr-auto flex w-fit gap-1 rounded-2xl rounded-bl-md border border-slate-200 bg-white px-4 py-3"
    >
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          style={{ animationDelay: `${delay}ms` }}
          className="size-2 animate-bounce rounded-full bg-slate-400"
        />
      ))}
    </div>
  );
}

interface MessageListProps {
  messages: ChatMessage[];
  typing: boolean;
  emptyState: ReactNode;
}

export function MessageList({ messages, typing, emptyState }: MessageListProps) {
  const end = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever the conversation grows or the indicator toggles
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [messages.length, typing]);

  return (
    <div
      role="log"
      aria-live="polite"
      aria-label="Conversation"
      className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
    >
      {messages.length === 0 ? emptyState : null}
      {messages.map((message) => (
        <Bubble key={message.id} message={message} />
      ))}
      {typing ? <TypingIndicator /> : null}
      <div ref={end} />
    </div>
  );
}
