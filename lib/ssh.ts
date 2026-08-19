import { execFile } from 'node:child_process';
import { appConfig } from './config';
import type { ServerConfig } from './types';

export type SshAction = 'restart' | 'status' | 'logs';

function unitName(server: ServerConfig): string {
  return server.kind === 'smp' ? 'smp-server' : 'xftp-server';
}

/**
 * The remote command for each action. On the VM side the smmonitor user is
 * restricted (sudoers + authorized_keys) to exactly these commands — see
 * deploy/ansible. Never interpolate user input here.
 */
function remoteCommand(server: ServerConfig, action: SshAction): string[] {
  const unit = unitName(server);
  switch (action) {
    case 'restart':
      return ['sudo', 'systemctl', 'restart', `${unit}.service`];
    case 'status':
      return ['systemctl', 'is-active', `${unit}.service`];
    case 'logs':
      return ['journalctl', '-u', `${unit}.service`, '-n', '200', '--no-pager', '-o', 'short-iso'];
  }
}

export interface SshResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export function runSsh(server: ServerConfig, action: SshAction): Promise<SshResult> {
  const { keyPath, timeoutSec } = appConfig.ssh;
  const args = [
    '-o',
    'BatchMode=yes',
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    `ConnectTimeout=${Math.min(timeoutSec, 10)}`,
    '-p',
    String(server.ssh.port),
  ];
  if (keyPath) args.push('-i', keyPath);
  args.push(`${server.ssh.user}@${server.ssh.host}`, '--', ...remoteCommand(server, action));

  return new Promise((resolve) => {
    execFile(
      'ssh',
      args,
      { timeout: timeoutSec * 1000, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({ ok: error === null, stdout: stdout.trim(), stderr: stderr.trim() });
      },
    );
  });
}
