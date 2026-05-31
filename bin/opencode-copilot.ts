#!/usr/bin/env bun
/**
 * opencode-copilot CLI — Feishu ↔ opencode TUI 双向桥
 *
 * Usage:
 *   opencode-copilot start    # Start the bridge daemon
 *   opencode-copilot stop     # Stop the bridge
 *   opencode-copilot status   # Check running status
 *   opencode-copilot restart  # Stop + start
 *   opencode-copilot dev      # Run in foreground (--watch)
 */

import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectDir = join(__dirname, '..')
const manageScript = join(projectDir, 'scripts', 'manage.ts')

const args = process.argv.slice(2)
const cmd = args[0] || 'help'

switch (cmd) {
  case 'start':
  case 'stop':
  case 'status':
  case 'restart': {
    const proc = spawn('bun', ['run', manageScript, cmd], {
      cwd: projectDir,
      stdio: 'inherit',
    })
    await new Promise<void>((resolve) => proc.on('close', () => resolve()))
    break
  }
  case 'dev': {
    const proc = spawn('bun', ['--watch', 'run', 'src/index.ts'], {
      cwd: projectDir,
      stdio: 'inherit',
    })
    await new Promise<void>((resolve) => proc.on('close', () => resolve()))
    break
  }
  default:
    console.log(`opencode-copilot — Feishu ↔ opencode TUI 双向桥

Usage:
  opencode-copilot start     Start the bridge
  opencode-copilot stop      Stop the bridge
  opencode-copilot status    Check running status
  opencode-copilot restart   Restart the bridge
  opencode-copilot dev       Run in foreground (watch mode)

Setup:
  1. Create .env in working directory:
     FEISHU_APP_ID=cli_xxxx
     FEISHU_APP_SECRET=xxxx
  2. opencode-copilot start
`)
}
