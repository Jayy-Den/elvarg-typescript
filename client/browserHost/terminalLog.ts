const ANSI_COLOR = /\u001b\[[0-9;]*m/g;

/** Append process output while treating carriage returns as terminal line updates. */
export function appendTerminalLog(lines: string[], message: string): string[] {
    const next = [...lines];
    for (const line of message.replace(ANSI_COLOR, "").split(/\r?\n/)) {
        if (!line) continue;
        const carriageReturn = line.lastIndexOf("\r");
        const text = carriageReturn < 0 ? line : line.slice(carriageReturn + 1);
        if (carriageReturn < 0) next.push(text);
        else if (next.length > 0) next[next.length - 1] = text;
        else next.push(text);
    }
    return next.slice(-300);
}
