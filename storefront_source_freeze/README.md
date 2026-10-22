# Storefront source freeze

This package binds the fixed source closure that can publish products, accept
payment, enforce the Gen 3 shipping and finite-inventory rules, capture an
authorized payment, and operate reservation expiry. It includes the complete
MkDocs `docs/` input, including the service worker and Pages routing controls;
all Pages Functions; hooks, templates, frontend assets, supporting modules,
inventory migration and worker, operational tools, tests, build configuration,
dependencies, and CI workflow.

The package deliberately excludes generated `site/` output, caches,
dependencies, credentials, local development settings, provider state, and
deployment state. Source-only verification returns `release_ready: false`.
Release verification additionally requires a fully clean worktree, exact
current HEAD bytes, canonical index flags, no ignored production additions,
and no local credential files.

The manifest is create-once and publication holds every parent directory with
component-wise no-follow descriptor custody. The verifier rejects file or
directory additions, deletion, substitution, symlinks, hardlinks, path escape,
scope weakening, manifest drift, and Git concealment.

```sh
python3 storefront_source_freeze/verify_storefront_source_freeze.py verify \
  --repo-root /absolute/path/to/Project-Documentation-Site
```

```sh
python3 storefront_source_freeze/verify_storefront_source_freeze.py verify-release \
  --repo-root /absolute/path/to/Project-Documentation-Site
```

This is a source boundary only. It does not publish the site, contact Stripe or
Cloudflare, provision inventory, authorize a sale, or establish carrier,
battery, packaging, or physical qualification.
