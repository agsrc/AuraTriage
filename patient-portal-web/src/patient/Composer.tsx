import { type FormEvent, type KeyboardEvent, useRef, useState } from "react";
import { SendIcon } from "../components/Icons";

const MAX_LENGTH = 2000;
const COUNTER_FROM = 1800;

interface ComposerProps {
  disabled: boolean;
  placeholder: string;
  onSend(text: string): Promise<void>;
}

export function Composer({ disabled, placeholder, onSend }: ComposerProps) {
  const [text, setText] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);

  async function submit() {
    const value = text.trim();
    if (value === "" || disabled) return;
    setText("");
    await onSend(value);
    input.current?.focus();
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void submit();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter adds a line. Do not send while an IME is composing text.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <form onSubmit={onSubmit} className="border-t border-slate-200 bg-white p-3">
      <div className="flex items-end gap-2">
        <label htmlFor="message" className="sr-only">
          Message
        </label>
        <textarea
          id="message"
          ref={input}
          rows={1}
          maxLength={MAX_LENGTH}
          value={text}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          aria-describedby="composer-hint"
          className="field-sizing-content max-h-40 min-h-11 flex-1 resize-none rounded-xl border border-slate-300 bg-white px-3 py-2.5 placeholder:text-slate-500 disabled:bg-slate-100"
        />
        <button
          type="submit"
          disabled={disabled || text.trim() === ""}
          className="flex h-11 items-center gap-2 rounded-xl bg-brand-600 px-4 font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span>Send</span>
          <SendIcon className="size-4" />
        </button>
      </div>
      <p id="composer-hint" className="sr-only">
        Press Enter to send, Shift and Enter for a new line.
      </p>
      {text.length >= COUNTER_FROM ? (
        <p className="mt-1 text-right text-xs text-slate-600" aria-live="polite">
          {MAX_LENGTH - text.length} characters left
        </p>
      ) : null}
    </form>
  );
}
