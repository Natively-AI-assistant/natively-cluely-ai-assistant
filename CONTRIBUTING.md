# Contributing to Natively

First off, thank you for considering contributing to Natively! It's people like you that make Natively such a great tool.

Following these guidelines helps to communicate that you respect the time of the developers managing and developing this source-available project. In return, they should reciprocate that respect in addressing your issue, assessing changes, and helping you finalize your pull requests.

## Contribution Terms

Contributions to Natively are welcome.

By submitting a pull request, issue, patch, idea, documentation, design, prompt, workflow, or other contribution, you agree that Natively AI Private Limited may use, modify, distribute, commercialize, and relicense your contribution as part of Natively or any other Natively AI Private Limited product or service.

Please do not submit contributions unless you have the legal right to do so.

## Table of Contents

- [Contribution Terms](#contribution-terms)
- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
  - [Reporting Bugs](#reporting-bugs)
  - [Suggesting Enhancements](#suggesting-enhancements)
  - [Pull Requests](#pull-requests)
- [Development Workflow](#development-workflow)
  - [Prerequisites](#prerequisites)
  - [Local Development](#local-development)
  - [Architecture Overview](#architecture-overview)
- [Styleguides](#styleguides)
  - [Git Commit Messages](#git-commit-messages)

## Code of Conduct

This project and everyone participating in it is governed by the [Natively Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior to evinjohnn@gmail.com.

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check the issue tracker as you might find out that you don't need to create one. When you are creating a bug report, please include as many details as possible:

- Use a clear and descriptive title for the issue to identify the problem.
- Describe the exact steps which reproduce the problem in as many details as possible.
- Provide specific examples to demonstrate the steps.
- Describe the behavior you observed after following the steps and point out what exactly is the problem with that behavior.
- Explain which behavior you expected to see instead and why.
- Include screenshots and animated GIFs which show you following the described steps and clearly demonstrate the problem.
- Specify your OS version.
- Specify your Node/Npm versions.

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When you are creating an enhancement suggestion, please include:

- Use a clear and descriptive title for the issue to identify the suggestion.
- Provide a step-by-step description of the suggested enhancement in as many details as possible.
- Provide specific examples to demonstrate the steps.
- Describe the current behavior and explain which behavior you expected to see instead and why.
- Explain why this enhancement would be useful to most Natively users.

### Pull Requests

- Fill in the required template
- Do not include issue numbers in the PR title
- Include screenshots and animated GIFs in your pull request whenever possible.
- Follow the TypeScript and React styleguides.
- Document new code based on the Documentation Styleguide.
- End all files with a newline.

## Development Workflow

### Prerequisites

- Node.js (v20+ recommended)
- Git
- Rust (required for native audio capture compilation)

### Local Development

1. Fork the repo and create your branch from `main`.
2. Clone your fork locally: `git clone https://github.com/YOUR_USERNAME/natively-cluely-ai-assistant.git`
3. Install dependencies: `npm install`
4. Set up your `.env` file (refer to the README for template).
5. Start the development server: `npm start`

If you've added code that should be tested, add tests.
If you've changed APIs, update the documentation.
Ensure the test suite passes.

### Architecture Overview

Natively uses a modern stack consisting of:

- **Frontend**: React, Vite, TypeScript, TailwindCSS
- **Backend/Desktop**: Electron
- **Native Audio**: Rust (`napi-rs` for zero-copy ABI transfers)
- **Database**: SQLite (local storage with `sqlite-vec` for RAG)

When contributing, ensure you understand which context (Main Process, Renderer Process, or Native/Rust addon) your code will run in, and use the IPC correctly for communication.

## Styleguides

### Git Commit Messages

- Use the present tense ("Add feature" not "Added feature")
- Use the imperative mood ("Move cursor to..." not "Moves cursor to...")
- Limit the first line to 72 characters or less
- Reference issues and pull requests liberally after the first line
- Consider starting the commit message with an applicable emoji:
  - 🎨 `:art:` when improving the format/structure of the code
  - 🐎 `:racehorse:` when improving performance
  - 🚱 `:non-potable_water:` when plugging memory leaks
  - 📝 `:memo:` when writing docs
  - 🐧 `:penguin:` when fixing something on Linux
  - 🍎 `:apple:` when fixing something on macOS
  - 🏁 `:checkered_flag:` when fixing something on Windows
  - 🐛 `:bug:` when fixing a bug
  - 🔥 `:fire:` when removing code or files
  - 💚 `:green_heart:` when fixing the CI build
  - ✅ `:white_check_mark:` when adding tests
  - 🔒 `:lock:` when dealing with security
  - ⬆️ `:arrow_up:` when upgrading dependencies
  - ⬇️ `:arrow_down:` when downgrading dependencies

Thank you for contributing to Natively!
