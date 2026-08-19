import tls from 'node:tls';
import type { ServerConfig } from '../lib/types';
import { resolveHost } from './probe';

export interface CertCheck {
  notAfter: number | null;
  issuer: string | null;
  error: string | null;
}

/**
 * Reads the TLS certificate presented on the server's public port. SimpleX
 * servers use self-signed certs pinned by fingerprint, so verification is
 * disabled - we only want the expiry date of the online (leaf) certificate.
 * Connects to the resolved IPv4 address (with SNI) so the check does not
 * silently dial an unroutable AAAA record.
 */
export async function checkCert(server: ServerConfig, timeoutMs = 10000): Promise<CertCheck> {
  const ip = await resolveHost(server.host, 'ipv4');
  if (!ip) {
    return { notAfter: null, issuer: null, error: `DNS: no A record for ${server.host}` };
  }
  return new Promise((resolve) => {
    let settled = false;
    const done = (result: CertCheck) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    const socket = tls.connect(
      {
        host: ip,
        port: server.port,
        servername: server.host,
        rejectUnauthorized: false,
        // SMP/XFTP negotiate over ALPN; without it some versions close early,
        // but the certificate is still exchanged during the handshake.
        ALPNProtocols: ['smp/1', 'xftp/1'],
      },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        if (!cert || !cert.valid_to) {
          done({ notAfter: null, issuer: null, error: 'no certificate returned' });
          return;
        }
        const notAfter = Date.parse(cert.valid_to);
        const issuerCn = cert.issuer?.CN;
        done({
          notAfter: Number.isNaN(notAfter) ? null : notAfter,
          issuer: Array.isArray(issuerCn) ? (issuerCn[0] ?? null) : (issuerCn ?? null),
          error: null,
        });
      },
    );
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      done({ notAfter: null, issuer: null, error: 'timeout' });
    });
    socket.on('error', (err) => {
      const code = (err as NodeJS.ErrnoException).code;
      done({
        notAfter: null,
        issuer: null,
        error: (err.message || code || 'connection error').slice(0, 200),
      });
    });
  });
}
