#!/usr/bin/env node
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
    const proc = spawn('npx', ['tsx', manageScript, cmd], {
      cwd: projectDir,
      stdio: 'inherit',
    })
    proc.on('close', (code) => process.exit(code))
    break
  }
  case 'dev': {
    const proc = spawn('npx', ['tsx', 'watch', 'src/index.ts'], {
      cwd: projectDir,
      stdio: 'inherit',
    })
    proc.on('close', (code) => process.exit(code))
    break
  }
  default:
    console.log(`opencode-copilot — Feishu ↔ opencode TUI bridge

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