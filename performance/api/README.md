# MetadataDB Performance Tests

This directory contains the Python-based load tests used to validate the performance of the MetadataDB service.

The goal of these tests is to exercise realistic access patterns by populating a temporary environment with a substantial graph structure (over 100 nodes and more than 200 edges) and then running multistep traversals. The stage deployment is used so that production data remains unaffected while still providing a close simulation of real workloads.

## Overview

1. **Cleanup** – The test scripts remove any existing test data so each run starts from a known state.
2. **Setup** – `load.py` creates 100 nodes and 200 edges. The nodes contain sample properties including numbers, timestamps, and arbitrary metadata to mimic real usage. Edges link nodes with different relationship types and weights.
3. **Load Operations** – A mix of reads, updates and traversals is executed concurrently to simulate heavy traffic. The script gathers latency metrics, status code counts and error details.
4. **Traversal Validation** – `traversal-test.py` extends the basic load test by creating a linear chain of nodes. It repeatedly traverses this chain to validate long, multistep path lookups.
5. **Reporting** – After the test finishes, a detailed latency report is generated and saved as a log file for inspection.

## Running Locally

```bash
cd performance/api
python -m pip install -r requirements.txt
CF_WORKER_URL=http://localhost ENV_JWT_SECRET=local-secret python load.py
```

The scripts rely on the environment variables listed below. When running locally, adjust them as needed:

- `CF_WORKER_URL` – Base URL of the worker instance.
- `ENV_JWT_SECRET` – Secret used to sign test JWTs.
- `CF_CONCURRENT_REQUESTS` – Number of requests to issue in parallel (defaults to 10).

The same settings are used by `traversal-test.py`.

## Continuous Integration

Performance tests run automatically in the `cf-graphdb-api` workflow. After unit tests succeed and the API is deployed to the stage environment, the workflow executes both `load.py` and `traversal-test.py`. Metrics are archived as build artifacts so regressions are easy to spot.

Excerpt from `.github/workflows/cf-graphdb-api.yml`:

```yaml
  performance:
    runs-on: ubuntu-latest
    needs: test
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
      - name: Set up Python 3.12
        uses: actions/setup-python@v5
      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          pip install -r requirements.txt
        working-directory: performance/api
      - name: Run load tests
        run: |
          python load.py
          python traversal-test.py
        working-directory: performance/api
```

By executing the tests against the stage worker URL specified in repository secrets, we confirm that high‑volume graph operations, complex properties and long traversals behave correctly before changes reach production.

## Validating Access Patterns

The generated report includes latency percentiles for every endpoint as well as traversal times through a ten‑node chain. These metrics show how the database handles different access patterns—such as reading node lists, updating properties or walking large graphs—under load. Repeating the process on each CI run ensures new changes do not degrade performance or break traversal logic.

