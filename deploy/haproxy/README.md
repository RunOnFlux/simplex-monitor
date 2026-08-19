# Fronting the dashboard with HAProxy

If the VPS already runs HAProxy on 80/443 (as the RunOnFlux status VPS does),
skip nginx entirely (`systemctl disable nginx`) and route a hostname straight
to the app on 127.0.0.1:3334.

Add to the existing TLS-terminating frontend:

```haproxy
    acl host_simplex_monitor hdr(host) -i monitor.simplexonflux.com
    use_backend simplex_monitor if host_simplex_monitor
```

And a backend:

```haproxy
backend simplex_monitor
    option forwardfor
    http-request set-header X-Forwarded-Proto https
    # Restart requests block until the unit is fully up (the xftp units wait
    # for Postgres), up to ~75s - don't let haproxy 504 them first.
    timeout server 90s
    server monitor 127.0.0.1:3334
```

Then validate and reload:

```bash
haproxy -c -f /etc/haproxy/haproxy.cfg && systemctl reload haproxy
```

Notes:

- `option forwardfor` is required: the app rate-limits login-code requests by
  `X-Forwarded-For`. Without it every visitor shares one bucket.
- The hostname needs an A record pointing at the VPS and a certificate in
  HAProxy's crt list, managed however the box's other certs are.
- No websockets are involved; plain HTTP proxying is sufficient.
