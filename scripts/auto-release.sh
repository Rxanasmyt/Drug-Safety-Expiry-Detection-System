#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# PharmaCare — Auto Git Release Script
# Usage: ./scripts/auto-release.sh "feat: description" [major|minor|patch]
# Example: ./scripts/auto-release.sh "feat: add emergency box" minor
# ─────────────────────────────────────────────────────────────
set -e

COMMIT_MSG="${1:-chore: update}"
BUMP="${2:-patch}"   # major | minor | patch
BRANCH=$(git branch --show-current)
REPO="Rxanasmyt/Drug-Safety-Expiry-Detection-System"

echo ""
echo "══════════════════════════════════════════"
echo "  PharmaCare Auto Release"
echo "══════════════════════════════════════════"

# ── 1. Stage & commit ─────────────────────────────────────────
echo ""
echo "📦  [1/4] Staging changes..."
git add .

CHANGED=$(git diff --cached --name-only)
if [ -z "$CHANGED" ]; then
  echo "⚠️   No changes to commit."
  exit 0
fi
echo "    Files: $(echo "$CHANGED" | wc -l | tr -d ' ') changed"

git commit -m "$COMMIT_MSG"
echo "✅  Committed: $COMMIT_MSG"

# ── 2. Calculate next SemVer ──────────────────────────────────
echo ""
echo "🏷️   [2/4] Calculating version..."
LATEST=$(git tag -l 'v*' | sort -V | tail -n 1)

if [ -z "$LATEST" ]; then
  NEXT="v1.0.0"
else
  VERSION="${LATEST#v}"
  MAJOR=$(echo "$VERSION" | cut -d. -f1)
  MINOR=$(echo "$VERSION" | cut -d. -f2)
  PATCH=$(echo "$VERSION" | cut -d. -f3)

  case "$BUMP" in
    major) MAJOR=$((MAJOR+1)); MINOR=0; PATCH=0 ;;
    minor) MINOR=$((MINOR+1)); PATCH=0 ;;
    *)     PATCH=$((PATCH+1)) ;;
  esac

  NEXT="v${MAJOR}.${MINOR}.${PATCH}"
fi

echo "    $LATEST → $NEXT  ($BUMP bump)"
git tag "$NEXT"

# ── 3. Push commit + tag ──────────────────────────────────────
echo ""
echo "🚀  [3/4] Pushing to origin/$BRANCH..."
git push origin "$BRANCH"
git push --tags
echo "✅  Pushed: $NEXT → origin/$BRANCH"

# ── 4. Create GitHub Release (requires GH_TOKEN) ─────────────
echo ""
echo "📋  [4/4] Creating GitHub Release..."

if [ -z "$GH_TOKEN" ]; then
  echo "⚠️   GH_TOKEN not set — skipping auto-release."
  echo "    Create manually: https://github.com/$REPO/releases/new?tag=$NEXT"
else
  BODY="Release $NEXT — $(date '+%Y-%m-%d')\n\n### Changes\n$COMMIT_MSG"
  RESPONSE=$(curl -s -X POST \
    -H "Authorization: token $GH_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/$REPO/releases" \
    -d "{\"tag_name\":\"$NEXT\",\"target_commitish\":\"$BRANCH\",\"name\":\"$NEXT\",\"body\":\"$BODY\",\"draft\":false,\"prerelease\":false}")

  URL=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('html_url','ERROR'))" 2>/dev/null)
  if [[ "$URL" == http* ]]; then
    echo "✅  Release: $URL"
  else
    echo "⚠️   API blocked in this environment."
    echo "    Create manually: https://github.com/$REPO/releases/new?tag=$NEXT"
  fi
fi

echo ""
echo "══════════════════════════════════════════"
echo "  Done! Version $NEXT deployed."
echo "══════════════════════════════════════════"
echo ""
