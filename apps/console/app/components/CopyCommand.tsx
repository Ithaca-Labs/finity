"use client";

import { useState } from "react";

export function CopyCommand({ command }: Readonly<{ command: string }>) {
  const [copied, setCopied] = useState(false);

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="command-box">
      <code><span className="command-prompt">$</span> {command}</code>
      <button type="button" onClick={copyCommand}>{copied ? "copied" : "copy"}</button>
    </div>
  );
}
