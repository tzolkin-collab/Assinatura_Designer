---
name: svgl-logos
description: Use real SVG logos from svgl.app for architecture diagrams, documentation, and microservices visualizations. Trigger when the user asks for service icons, tech logos, cloud provider icons, database logos, framework icons, or any SVG asset for diagrams and docs.
---

# SVGL Logos

Use this skill to provide accurate, official SVG logos for technology services, cloud providers, databases, frameworks, and devtools instead of inventing placeholder graphics.

## Where logos live

All SVG files are in `assets/`:

```
.kimi/skills/svgl-logos/
├── assets/        # SVG files from svgl.app
└── references/
    └── catalog.md # Full catalog with usage notes
```

## How to use

1. Copy the desired SVG from `assets/` into the target project location.
2. Prefer light/dark variants when the UI supports theming.
3. Use wordmark variants when the logo must include the brand name.
4. Keep the `viewBox` intact; adjust only `width`, `height`, or CSS.

## Core categories

- **Containers / Orchestration**: `docker.svg`, `kubernetes.svg`
- **Cloud**: `aws_light.svg`, `azure.svg`, `google-cloud.svg`, `cloudflare.svg`, `cloudflare-workers.svg`, `digitalocean.svg`, `fly.svg`, `heroku.svg`, `netlify.svg`, `railway.svg`, `vercel.svg`
- **Databases**: `postgresql.svg`, `mysql-icon-light.svg`, `mongodb-icon-light.svg`, `redis.svg`, `sqlite.svg`, `upstash.svg`, `neon.svg`, `planetscale.svg`, `supabase.svg`, `firebase.svg`
- **Backend / Runtimes**: `nodejs.svg`, `bun.svg`, `expressjs.svg`, `fastify.svg`, `nestjs.svg`, `python.svg`, `golang.svg`, `graphql.svg`
- **Frontend**: `react_light.svg` / `react_dark.svg`, `vue.svg`, `svelte.svg`, `angular.svg`, `tailwindcss.svg`, `javascript.svg`, `typescript.svg`
- **Auth**: `auth0.svg`, `jwt.svg`
- **Monitoring / IaC**: `grafana.svg`, `terraform.svg`
- **Messaging**: `apache-kafka-light.svg` / `apache-kafka-dark.svg`
- **Version Control**: `github_light.svg` / `github_dark.svg`, `gitlab.svg`

## Missing logo?

If a requested service is not in `assets/`:

1. Check `references/catalog.md` for the full list.
2. If still missing, fetch it from the official SVGL repository at `https://github.com/pheralb/svgl/tree/main/static/library`.
3. Only fall back to a generic placeholder if no official SVG exists.

## Credits

All logos come from [svgl.app](https://svgl.app) by [pheralb](https://github.com/pheralb), MIT license.
