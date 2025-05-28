# Deployment Environments

The project is configured with three isolated environments managed via Wrangler:

- **dev** – Used exclusively for local development. CI systems do not have access. This environment runs on your machine using `wrangler dev` and is never publicly exposed.
- **stage** – Continuously deployed by the CI pipeline for every change. Only CI credentials can access this environment. A synthetic load test runs here to verify query efficiency and validate our cost models.
- **prod** – The production API serving real traffic. Promotion to prod requires manual verification and runs the same tests and lint checks as stage.

Secrets such as the JWT signing key and database credentials are configured per environment through Wrangler. This ensures each tier remains isolated while sharing the same codebase.
