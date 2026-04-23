# CI Setup Guide

This document describes how to configure GitHub Actions for this project.

## Required: GitHub App Token for Private Submodule

The `premium` submodule is a private repository. GitHub Actions needs a token to access it.

### Option 1: GitHub App Token (Recommended for Organizations)

**Pros:**
- Organization-level permissions
- Can be restricted to specific repos
- Expires automatically
- More secure than PAT

**Setup:**
1. Create a GitHub App in your organization settings
2. Grant read access to the `natively-premium` repository
3. Install the app on your repository
4. Add secret `GH_APP_TOKEN` with value from the app installation

**Docs:** https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/about-github-apps

### Option 2: Deploy Key (Simpler)

**Pros:**
- Simple SSH key setup
- No external dependencies

**Setup:**
1. Generate SSH key: `ssh-keygen -t ed25519 -C "ci-deploy-key" -f github_deploy_key`
2. Add public key to `natively-premium` repo (Deploy Keys settings)
3. Add private key as secret `GH_APP_TOKEN` (base64 encoded):
   ```bash
   cat github_deploy_key | base64 -w 0
   ```
4. Add to workflow:
   ```yaml
   - uses: actions/checkout@v4
     with:
       submodules: true
       ssh-key: ${{ secrets.GH_APP_TOKEN }}
   ```

## Secrets Configuration

Navigate to: `Settings > Secrets and variables > Actions`

Add a new repository secret:

| Name | Value | Notes |
|------|-------|-------|
| `GH_APP_TOKEN` | Token with premium repo access | Required for submodule cloning |

## Workflow Overview

| Workflow | Triggers | OS Matrix | Tests |
|----------|----------|----------|-------|
| `test.yml` | push + PR | Windows + macOS | Unit + Integration |
| `e2e.yml` | push + PR + manual | Windows + macOS | Playwright E2E |
| `build-smoke.yml` | PR + manual | macOS | Build verification |

## Running Tests Locally

```bash
# Unit tests
npm run test

# E2E tests (requires dev server)
npm run test:e2e

# All tests
npm run test:all
```
