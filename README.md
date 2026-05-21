# 🔭 Portlens

**Share your localhost app with anyone — instantly.**

No account. No firewall config. One command.

```bash
npx portlens 3000
```

Recipients get a clean, branded preview link — not a raw tunnel URL.

---

## Why Portlens

Every existing tunnel tool (ngrok, Cloudflare Tunnel) was built for developers. The person **receiving** the link still gets a suspicious-looking URL, zero context, and no idea what they're looking at.

Portlens fixes the recipient experience:

| | ngrok / Cloudflare | **Portlens** |
|---|---|---|
| Setup for sender | CLI install + account | `npx portlens 3000` |
| Recipient experience | Raw tunnel URL | Clean branded preview |
| Context for recipient | None | Title + description |
| Account required | Yes | No (free tier) |
| Link expiry warning | No | Yes |

---

## Quick Start

**No install required:**
```bash
npx portlens 3000
```

**Or install globally:**
```bash
npm install -g portlens
portlens 3000
```

**With a description for the recipient:**
```bash
portlens 3000 --title "Invoice App" --desc "Review the new payment flow"
```

Your terminal will show:
```
🔭 Portlens
✔ Tunnel established
✔ Live at → https://viewer.portlens.net/abc123
  Expires in 2 hours · Share this link
```

---

## How It Works

```
Your Machine                  Portlens Relay               Recipient's Browser
┌──────────────┐              ┌──────────────┐             ┌──────────────────┐
│ localhost:3000│◄────────────►│ portlens.net │◄───────────►│ portlens.net/    │
│  (private)   │  WebSocket   │  (public)    │    HTTP     │ abc123           │
└──────────────┘              └──────────────┘             └──────────────────┘
```

1. `npx portlens 3000` opens a WebSocket tunnel to the Portlens relay server
2. Relay generates a unique short URL
3. Recipient opens the URL — sees your app inside a clean viewer UI
4. All traffic proxies through the relay in real time
5. Link expires after 2 hours (upgrade for persistent links)

---

## CLI Options

```bash
portlens <port> [options]

Arguments:
  port                    Local port to expose (default: 3000)

Options:
  --title <text>          Title shown to recipient in the preview UI
  --desc <text>           Short description shown below the title
  --no-open               Don't auto-open the link in your browser
  --qr                    Print a QR code for the share URL
  -v, --version           Show version number
  -h, --help              Show help
```

**Examples:**
```bash
portlens 3000                                  # basic tunnel
portlens 8080 --title "Admin Panel"            # with title
portlens 3000 --qr                             # show QR code
portlens 5173 --desc "New onboarding UI draft" # with description
```

---

## Recipient Experience

When someone opens your Portlens link, they see:

```
┌─────────────────────────────────────────────┐
│ 🔭 Portlens  |  Invoice App                 │
│ "Review the new payment flow"  · 1h 43m left│
├─────────────────────────────────────────────┤
│                                             │
│           [ your app renders here ]         │
│                                             │
└─────────────────────────────────────────────┘
```

No CLI. No install. No confusion.

---

## Pricing

| | Free | Pro ($8/mo) |
|---|---|---|
| Link expiry | 2 hours | Never |
| Custom subdomain | ✗ | ✓ (`you.portlens.dev`) |
| Concurrent tunnels | 1 | Unlimited |
| Password protection | ✗ | ✓ |
| Dashboard | ✗ | ✓ |

Start free — no account needed. [Upgrade at portlens.dev →](https://portlens.dev)

---

## Requirements

- Node.js 16 or higher
- Any app running on localhost

---

## Monorepo

This package is part of the Portlens monorepo:

```
portlens/
├── packages/
│   ├── cli/        ← you are here
│   └── shared/     ← shared types and utilities
```

The relay server and viewer UI are maintained separately.

---

## Contributing

```bash
# Clone the repo
git clone https://github.com/MultiAgentDev/portlens
cd portlens

# Install dependencies
npm install

# Run CLI locally
npm run dev --workspace=packages/cli

# Link for local testing
npm link --workspace=packages/cli
portlens 3000
```

Bug reports and feature requests are welcome via [GitHub Issues](https://github.com/MultiAgentDev/portlens/issues).

---

## License

MIT © Portlens

---

<p align="center">
  <a href="https://portlens.net">portlens.net</a> ·
  <a href="https://github.com/MultiAgentDev/portlens/issues">Issues</a> ·
</p>
