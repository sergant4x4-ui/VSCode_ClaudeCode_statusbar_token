const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_CONTEXT_WINDOW = 200000;

function formatK(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

function findProjectJsonlFiles() {
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  const results = [];
  let dirs;
  try {
    dirs = fs.readdirSync(projectsDir, { withFileTypes: true });
  } catch (e) {
    return results;
  }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const full = path.join(projectsDir, d.name);
    let files;
    try {
      files = fs.readdirSync(full);
    } catch (e) {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const fp = path.join(full, f);
      try {
        const stat = fs.statSync(fp);
        results.push({ path: fp, mtime: stat.mtimeMs });
      } catch (e) {
        // файл мог исчезнуть между readdir и stat — пропускаем
      }
    }
  }
  return results;
}

function readLastUsage(filePath) {
  let content;
  try {
    const stat = fs.statSync(filePath);
    const readSize = Math.min(stat.size, 200000);
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(readSize);
    fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
    fs.closeSync(fd);
    content = buf.toString('utf8');
  } catch (e) {
    return null;
  }

  const lines = content.split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    let obj;
    try {
      obj = JSON.parse(lines[i]);
    } catch (e) {
      continue; // последняя строка могла обрезаться на середине записи
    }
    const usage = obj && obj.message && obj.message.usage;
    if (usage) {
      return {
        input: usage.input_tokens || 0,
        output: usage.output_tokens || 0,
        cacheCreate: usage.cache_creation_input_tokens || 0,
        cacheRead: usage.cache_read_input_tokens || 0,
        model: obj.message.model || ''
      };
    }
  }
  return null;
}

function activate(context) {
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -100000);
  context.subscriptions.push(statusBarItem);

  function update() {
    const files = findProjectJsonlFiles();
    if (files.length === 0) {
      statusBarItem.hide();
      return;
    }
    files.sort((a, b) => b.mtime - a.mtime);
    const latest = files[0];
    const usage = readLastUsage(latest.path);
    if (!usage) {
      statusBarItem.hide();
      return;
    }
    const total = usage.input + usage.output + usage.cacheCreate + usage.cacheRead;
    const windowSize = DEFAULT_CONTEXT_WINDOW;
    const pct = Math.min(100, Math.round((total / windowSize) * 100));
    statusBarItem.text = `$(pulse) ${formatK(total)}/${formatK(windowSize)} tok (${pct}%)`;
    statusBarItem.tooltip = new vscode.MarkdownString(
      `**Claude Code — расход токенов**\n\n` +
      `Input: ${usage.input}\n\n` +
      `Output: ${usage.output}\n\n` +
      `Cache write: ${usage.cacheCreate}\n\n` +
      `Cache read: ${usage.cacheRead}\n\n` +
      `Сессия: ${path.basename(latest.path)}`
    );
    statusBarItem.show();
  }

  update();
  const interval = setInterval(update, 2000);
  context.subscriptions.push({ dispose: () => clearInterval(interval) });
}

function deactivate() {}

module.exports = { activate, deactivate };
