# Dependency Update Automation

This project implements an automated dependency update system that can automatically check and update all dependency packages to their latest stable versions and create Pull Requests automatically.

## 📋 Table of Contents

- [Overview](#overview)
- [Two Update Methods](#two-update-methods)
  - [Dependabot](#dependabot)
  - [Custom Workflow](#custom-workflow)
- [How to Use](#how-to-use)
- [Configuration](#configuration)
- [FAQ](#faq)

## Overview

The project includes two dependency update mechanisms:

1. **Dependabot**: GitHub's native dependency update tool that creates individual PRs for each dependency
2. **Custom Workflow**: Batch update workflow based on npm-check-updates that updates all dependencies at once

## Two Update Methods

### Dependabot

**Configuration File**: `.github/dependabot.yml`

**Features**:
- ✅ GitHub native support, runs with zero configuration
- ✅ Individual PR for each dependency, easy to review
- ✅ Automatic security vulnerability detection
- ✅ Supports multiple package managers
- ⏰ Runs automatically every Monday

**Update Scope**:
- Express backend dependencies (`/express-project`)
- Vue3 frontend dependencies (`/vue3-project`)
- GitHub Actions dependencies

**PR Configuration**:
- Maximum 10 concurrent PRs (npm dependencies)
- Maximum 5 concurrent PRs (GitHub Actions)
- Auto-added labels: `dependencies`, `backend`, `frontend`, `github-actions`
- Commit message format: `chore(deps): update xxx`

### Custom Workflow

**Configuration File**: `.github/workflows/update-dependencies.yml`

**Features**:
- ✅ Updates all dependencies to latest versions at once
- ✅ Supports manual triggering with selective update scope
- ✅ Auto-generates detailed change summary
- ✅ More aggressive update strategy
- ⏰ Runs automatically every Monday

**Update Strategy**:
Uses `npm-check-updates` (ncu) to update all dependencies to their latest stable versions, including major version updates.

## How to Use

### Method 1: Wait for Automatic Run

Both systems automatically run **every Monday at 08:00 UTC** to check and create update PRs.

### Method 2: Manually Trigger Custom Workflow

1. Go to the **Actions** page in your GitHub repository
2. Select the **Update Dependencies to Latest** workflow
3. Click the **Run workflow** button
4. Choose update target:
   - `all`: Update all frontend and backend dependencies
   - `frontend`: Update frontend dependencies only
   - `backend`: Update backend dependencies only
5. Click **Run workflow** to start execution

### Method 3: Review and Merge PRs

When dependency update PRs are created:

1. **Review PR Details**:
   - Check the list of updated dependencies
   - Review version changes
   - Read dependency Changelogs

2. **Test Changes**:
   ```bash
   # Pull PR branch
   git fetch origin
   git checkout <pr-branch>
   
   # Install dependencies
   cd vue3-project && npm ci
   cd ../express-project && npm ci
   
   # Build project
   cd vue3-project && npm run build
   cd ../express-project && npm run build
   
   # Run tests
   npm test  # If tests exist
   
   # Local verification
   npm run dev
   ```

3. **Merge PR**:
   - Merge PR after confirming tests pass
   - If issues arise, discuss in PR or close it

## Configuration

### Dependabot Configuration

Modify `.github/dependabot.yml` to customize Dependabot behavior:

```yaml
# Modify run schedule
schedule:
  interval: "weekly"
  day: "monday"
  time: "08:00"

# Modify concurrent PR limit
open-pull-requests-limit: 10

# Modify reviewers
reviewers:
  - "your-username"
```

### Custom Workflow Configuration

Modify `.github/workflows/update-dependencies.yml` to customize workflow behavior:

```yaml
# Modify run schedule
on:
  schedule:
    - cron: '0 8 * * 1'  # Every Monday at 08:00 UTC

# Modify ncu update strategy
run: ncu -u --target latest  # Update to latest version
run: ncu -u --target minor   # Update minor versions only
```

## FAQ

### Q: What's the difference between the two methods?

**A**: 
- **Dependabot**: Suitable for stable updates with individual review per dependency, recommended for production
- **Custom Workflow**: Suitable for rapid updates with batch upgrades, ideal for development or periodic major updates

### Q: What if the build fails after updates?

**A**: 
1. Check build logs in the PR to identify the cause
2. Check for breaking changes in major version updates
3. Review migration guides for affected dependencies
4. If unfixable, consider reverting the dependency version

### Q: How to disable auto-updates for specific dependencies?

**A**: 
For Dependabot, add to `.github/dependabot.yml`:

```yaml
updates:
  - package-ecosystem: "npm"
    directory: "/express-project"
    ignore:
      - dependency-name: "axios"
        update-types: ["version-update:semver-major"]
```

### Q: What if update frequency is too high?

**A**: 
Modify the run frequency:

```yaml
schedule:
  interval: "monthly"  # Change to monthly
```

### Q: How to view update history?

**A**: 
1. View workflow run history in GitHub Actions
2. Filter PRs with `dependencies` label
3. Review merged PRs for historical updates

## Best Practices

1. **Progressive Updates**: Prioritize merging Dependabot's individual updates, periodically use custom workflow for full updates
2. **Test Coverage**: Ensure adequate test coverage; automated tests quickly identify issues
3. **Version Locking**: Consider locking versions for critical dependencies using `package-lock.json`
4. **Monitor Logs**: Watch application logs after updates to catch runtime issues
5. **Regular Review**: Even with automation, regularly review security advisories and changelogs

## Related Resources

- [Dependabot Official Documentation](https://docs.github.com/en/code-security/dependabot)
- [npm-check-updates Documentation](https://github.com/raineorshine/npm-check-updates)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Semantic Versioning Specification](https://semver.org/)

---

**Maintainer Note**: This documentation updates with dependency system configuration changes. Please submit an Issue if you have questions.
