# `get.omnibazaar.com` — node-software install host setup

The node-software install path (the `curl … | sudo bash` one-liner) fetches from
`https://get.omnibazaar.com/node-software/…`. The bootstraps + WebApp `/download`
page are already wired to this host (default `OBZ_RELEASE_BASE`). It is **not yet
live** — it needs the DNS record + an Nginx vhost on the validator host. Until
then, installs work only with an explicit `OBZ_RELEASE_BASE` override.

Why a dedicated host (not `omnibazaar.com`): `omnibazaar.com` → `192.249.121.28`
(a separate marketing box) 406s curl and serves none of `/node-software`. The
staged files live on the validator host (`65.108.205.116:3001/node-software/…`,
HTTP 200, served by express.static).

## 1. DNS
Add at the ISP:
```
get.omnibazaar.com.   A   65.108.205.116
```

## 2. TLS (Let's Encrypt)
```
sudo certbot --nginx -d get.omnibazaar.com
```

## 3. Nginx vhost
Reverse-proxy to the validator's already-live static serving on :3001, plus the
short-URL redirects the bootstraps advertise (`/gateway`, `/service-node`):
```nginx
server {
    listen 443 ssl;
    server_name get.omnibazaar.com;

    # certbot fills in ssl_certificate / ssl_certificate_key

    # curl-friendly: no UA filtering, allow the install one-liner.
    location = /gateway      { return 302 /node-software/install-gateway.sh; }
    location = /service-node { return 302 /node-software/install-service-node.sh; }

    location /node-software/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
    }
}
server {                       # http → https
    listen 80;
    server_name get.omnibazaar.com;
    return 301 https://$host$request_uri;
}
```

## 4. Verify
```
curl -fsSL https://get.omnibazaar.com/node-software/install-service-node.sh | head -1   # → #!/usr/bin/env bash
curl -fsSL https://get.omnibazaar.com/gateway | head -1                                  # → (302 → script)
curl -fsSLI https://get.omnibazaar.com/node-software/v1.0.0/omnibazaar-service-node-1.0.0.tar.gz   # → 200
```

## 5. After DNS is live
Rebuild + redeploy WebApp so the `/download` page serves the updated scripts
(they were repointed to `get.omnibazaar.com` + Node 22 in this change):
`cd WebApp && npm run build`, then restart the validators one at a time
(quorum rule). The `OBZ_RELEASE_BASE` env override remains the escape hatch.

Note: the install scripts now provision **Node 22** (`setup_22.x`), not Node 20.
The Validator requires Node ≥22.18 at runtime (a workspace dep ships as TS source
that only loads with native type-stripping); the live validators already run
22.22, so Node-20 installs were a latent crash. See the desktop staging fix
(`stage-validator.js`) which removes that Node-version dependency for the desktop
bundle by transpiling internal deps to JS — the same systemic fix (ship
`@omnibazaar/liquidity-config` as built JS) would let the Linux installers drop
the Node-version requirement too.
