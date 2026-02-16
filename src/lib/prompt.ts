// ---------------------------------------------------------------------------
// Shared interactive CLI prompt utilities (no dependencies)
// ---------------------------------------------------------------------------

export interface MenuItem {
  label: string;
  hint?: string;
}

// ---------------------------------------------------------------------------
// Single-select menu (arrow keys + enter)
// ---------------------------------------------------------------------------

function renderSingleSelect(
  items: MenuItem[],
  selected: number,
  label: string
): string {
  const lines: string[] = [`  ${label}\n`];
  for (let i = 0; i < items.length; i++) {
    const pointer = i === selected ? "❯" : " ";
    const dim = i === selected ? "" : "\x1B[2m";
    const reset = i === selected ? "" : "\x1B[22m";
    const hint = items[i].hint ? `  \x1B[2m${items[i].hint}\x1B[22m` : "";
    lines.push(`  ${pointer} ${dim}${items[i].label}${reset}${hint}`);
  }
  lines.push("\n  \x1B[2m↑/↓ to move, enter to confirm\x1B[22m");
  return lines.join("\n");
}

/**
 * Prompt the user to pick one item from a list.
 * Returns the index of the selected item.
 */
export function promptSingleSelect(
  items: MenuItem[],
  label: string
): Promise<number> {
  if (items.length === 1) return Promise.resolve(0);

  return new Promise((resolve) => {
    let selected = 0;
    const menuHeight = items.length + 3;

    process.stdout.write("\x1B[?25l");
    process.stdout.write(renderSingleSelect(items, selected, label));

    const { stdin } = process;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();

    const cleanup = () => {
      stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
      stdin.removeListener("data", onKey);
      process.stdout.write("\x1B[?25h");
    };

    const clearMenu = () => {
      process.stdout.write(`\x1B[${menuHeight}A`);
      for (let i = 0; i < menuHeight; i++) {
        process.stdout.write("\x1B[2K\n");
      }
      process.stdout.write(`\x1B[${menuHeight}A`);
    };

    const redraw = () => {
      clearMenu();
      process.stdout.write(renderSingleSelect(items, selected, label));
    };

    const onKey = (data: Buffer) => {
      const key = data.toString();

      if (key === "\x03") {
        cleanup();
        process.stdout.write("\n");
        process.exit(0);
      }

      if (key === "\r" || key === "\n") {
        cleanup();
        clearMenu();
        resolve(selected);
        return;
      }

      if (key === "\x1B[A" || key === "k") {
        selected = (selected - 1 + items.length) % items.length;
        redraw();
        return;
      }

      if (key === "\x1B[B" || key === "j") {
        selected = (selected + 1) % items.length;
        redraw();
        return;
      }
    };

    stdin.on("data", onKey);
  });
}

// ---------------------------------------------------------------------------
// Multi-select menu (arrow keys + space to toggle, enter to confirm)
// ---------------------------------------------------------------------------

function renderMultiSelect(
  items: MenuItem[],
  cursor: number,
  toggled: Set<number>,
  label: string
): string {
  const lines: string[] = [`  ${label}\n`];
  for (let i = 0; i < items.length; i++) {
    const pointer = i === cursor ? "❯" : " ";
    const check = toggled.has(i) ? "◉" : "◯";
    const dim = i === cursor ? "" : "\x1B[2m";
    const reset = i === cursor ? "" : "\x1B[22m";
    const hint = items[i].hint ? `  \x1B[2m${items[i].hint}\x1B[22m` : "";
    lines.push(
      `  ${pointer} ${check} ${dim}${items[i].label}${reset}${hint}`
    );
  }
  lines.push(
    "\n  \x1B[2m↑/↓ to move, space to toggle, enter to confirm\x1B[22m"
  );
  return lines.join("\n");
}

/**
 * Prompt the user to select zero or more items from a list.
 * Returns an array of selected indices.
 */
export function promptMultiSelect(
  items: MenuItem[],
  label: string
): Promise<number[]> {
  return new Promise((resolve) => {
    let cursor = 0;
    const toggled = new Set<number>();
    const menuHeight = items.length + 3;

    process.stdout.write("\x1B[?25l");
    process.stdout.write(
      renderMultiSelect(items, cursor, toggled, label)
    );

    const { stdin } = process;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();

    const cleanup = () => {
      stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
      stdin.removeListener("data", onKey);
      process.stdout.write("\x1B[?25h");
    };

    const clearMenu = () => {
      process.stdout.write(`\x1B[${menuHeight}A`);
      for (let i = 0; i < menuHeight; i++) {
        process.stdout.write("\x1B[2K\n");
      }
      process.stdout.write(`\x1B[${menuHeight}A`);
    };

    const redraw = () => {
      clearMenu();
      process.stdout.write(
        renderMultiSelect(items, cursor, toggled, label)
      );
    };

    const onKey = (data: Buffer) => {
      const key = data.toString();

      if (key === "\x03") {
        cleanup();
        process.stdout.write("\n");
        process.exit(0);
      }

      if (key === "\r" || key === "\n") {
        cleanup();
        clearMenu();
        resolve([...toggled].sort((a, b) => a - b));
        return;
      }

      // Space to toggle
      if (key === " ") {
        if (toggled.has(cursor)) {
          toggled.delete(cursor);
        } else {
          toggled.add(cursor);
        }
        redraw();
        return;
      }

      if (key === "\x1B[A" || key === "k") {
        cursor = (cursor - 1 + items.length) % items.length;
        redraw();
        return;
      }

      if (key === "\x1B[B" || key === "j") {
        cursor = (cursor + 1) % items.length;
        redraw();
        return;
      }
    };

    stdin.on("data", onKey);
  });
}

// ---------------------------------------------------------------------------
// Visible text input (with optional default value)
// ---------------------------------------------------------------------------

/**
 * Prompt the user to enter a text value. Input is shown as typed.
 * If a default is provided it is shown in brackets; pressing enter
 * without typing accepts the default.
 * Returns the entered string, the default, or null if nothing was provided.
 */
export function promptText(
  label: string,
  defaultValue?: string
): Promise<string | null> {
  return new Promise((resolve) => {
    const hint = defaultValue ? ` \x1B[2m[${defaultValue}]\x1B[22m` : "";
    let value = "";

    process.stdout.write(`  ${label}${hint} `);

    const { stdin } = process;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();

    const cleanup = () => {
      stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
      stdin.removeListener("data", onKey);
    };

    const onKey = (data: Buffer) => {
      const str = data.toString();

      // Ctrl-C
      if (str === "\x03") {
        cleanup();
        process.stdout.write("\n");
        process.exit(0);
      }

      // Enter
      if (str === "\r" || str === "\n") {
        cleanup();
        process.stdout.write("\n");
        resolve(value.length > 0 ? value : defaultValue ?? null);
        return;
      }

      // Skip escape sequences (arrow keys, etc.)
      if (str.startsWith("\x1B")) return;

      // Process each character individually (handles paste)
      for (const ch of str) {
        // Backspace
        if (ch === "\x7F" || ch === "\b") {
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }

        // Ignore control characters
        if (ch.charCodeAt(0) < 32) continue;

        value += ch;
        process.stdout.write(ch);
      }
    };

    stdin.on("data", onKey);
  });
}

// ---------------------------------------------------------------------------
// Yes/no confirmation prompt
// ---------------------------------------------------------------------------

/**
 * Prompt the user to confirm a destructive or important action.
 * Shows a label and waits for y/n. Returns true if confirmed.
 */
export function promptConfirm(label: string): Promise<boolean> {
  return new Promise((resolve) => {
    process.stdout.write(`  ${label} \x1B[2m(y/N)\x1B[22m `);

    const { stdin } = process;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();

    const cleanup = () => {
      stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
      stdin.removeListener("data", onKey);
    };

    const onKey = (data: Buffer) => {
      const key = data.toString().toLowerCase();

      if (key === "\x03") {
        cleanup();
        process.stdout.write("\n");
        process.exit(0);
      }

      if (key === "y") {
        cleanup();
        process.stdout.write("y\n");
        resolve(true);
        return;
      }

      if (key === "n" || key === "\r" || key === "\n") {
        cleanup();
        process.stdout.write(key === "n" ? "n\n" : "\n");
        resolve(false);
        return;
      }
    };

    stdin.on("data", onKey);
  });
}

// ---------------------------------------------------------------------------
// Masked text input (characters shown as dots)
// ---------------------------------------------------------------------------

/**
 * Prompt the user to enter a secret value. Input is masked with dots.
 * Returns the entered string, or null if the user entered nothing.
 */
export function promptSecret(label: string): Promise<string | null> {
  return new Promise((resolve) => {
    let value = "";

    process.stdout.write(`  ${label}`);

    const { stdin } = process;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();

    const cleanup = () => {
      stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
      stdin.removeListener("data", onKey);
    };

    const onKey = (data: Buffer) => {
      const str = data.toString();

      // Ctrl-C
      if (str === "\x03") {
        cleanup();
        process.stdout.write("\n");
        process.exit(0);
      }

      // Enter
      if (str === "\r" || str === "\n") {
        cleanup();
        process.stdout.write("\n");
        resolve(value.length > 0 ? value : null);
        return;
      }

      // Skip escape sequences (arrow keys, etc.)
      if (str.startsWith("\x1B")) return;

      // Process each character individually (handles paste)
      for (const ch of str) {
        // Backspace
        if (ch === "\x7F" || ch === "\b") {
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }

        // Ignore control characters
        if (ch.charCodeAt(0) < 32) continue;

        value += ch;
        process.stdout.write("•");
      }
    };

    stdin.on("data", onKey);
  });
}
