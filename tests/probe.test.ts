import { describe, expect, it } from 'vitest';
import { buildAddress } from '../prober/probe';
import type { ServerConfig } from '../lib/types';

const smp: ServerConfig = {
  id: 'smp1',
  name: 'smp1.example.com',
  kind: 'smp',
  host: 'smp1.example.com',
  port: 5223,
  fingerprint: 'xQW_ufMkGE20UrTlBl8QqceG1tbuylXhr9VOLPyRJmw=',
  onion: 'qb4yoanyl4p7o33yrknv4rs6qo7ugeb2tu2zo66sbebezs4cpyosarid.onion',
  ssh: { host: 'smp1.example.com', user: 'smmonitor', port: 22 },
};

const xftp: ServerConfig = { ...smp, id: 'xftp1', kind: 'xftp', port: 443 };

describe('buildAddress', () => {
  it('builds IPv4 literal addresses with explicit port', () => {
    expect(buildAddress(smp, 'ipv4', '1.2.3.4')).toBe(
      'smp://xQW_ufMkGE20UrTlBl8QqceG1tbuylXhr9VOLPyRJmw=@1.2.3.4:5223',
    );
    expect(buildAddress(xftp, 'ipv4', '1.2.3.4')).toBe(
      'xftp://xQW_ufMkGE20UrTlBl8QqceG1tbuylXhr9VOLPyRJmw=@1.2.3.4:443',
    );
  });

  it('brackets IPv6 literals (validated against the simplexmq TransportHost parser)', () => {
    expect(buildAddress(smp, 'ipv6', '2a01:4f8::1')).toBe(
      'smp://xQW_ufMkGE20UrTlBl8QqceG1tbuylXhr9VOLPyRJmw=@[2a01:4f8::1]:5223',
    );
  });

  it('uses the onion host without a port for tor', () => {
    expect(buildAddress(smp, 'tor')).toBe(
      'smp://xQW_ufMkGE20UrTlBl8QqceG1tbuylXhr9VOLPyRJmw=@qb4yoanyl4p7o33yrknv4rs6qo7ugeb2tu2zo66sbebezs4cpyosarid.onion',
    );
  });
});
