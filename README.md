# ShiftBoard API

Sample shift scheduling service used as the target project for Runbook Compiler (IBM Bob 2.0 Hackathon, team Northliners).

## Run locally

    npm install
    cp .env.example .env   # then set real values
    npm run migrate
    npm start

Demo login: demo@shiftboard.dev / demo-password

## Scripts

- `npm test` unit tests
- `npm run migrate` apply pending migrations
- `npm run smoke` smoke tests (uses BASE_URL if set)
- `npm run build:image` build the Docker image tagged with the package version

The release process is documented in docs/release-runbook.pdf.
