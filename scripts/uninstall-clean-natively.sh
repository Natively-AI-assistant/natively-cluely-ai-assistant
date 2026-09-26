#!/usr/bin/env bash
#
# Natively Deep Cleaner / Uninstaller for macOS
# This script completely removes all cached data, local databases, models,
# preferences, and Keychain credentials from Natively and its older versions.
#
# WARNING: This will permanently delete your settings, local database, and downloaded models.

# Color definitions
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

echo -e "${RED}${BOLD}=====================================================${NC}"
echo -e "${RED}${BOLD}       Natively Deep Cleaner & Uninstaller           ${NC}"
echo -e "${RED}${BOLD}=====================================================${NC}"
echo -e "${YELLOW}This script will wipe all settings, databases, models, and credentials.${NC}"
echo ""

# Confirm before proceeding
read -p "Are you sure you want to proceed? (y/N): " -r confirm
if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

# Helper for removal
remove_dir() {
    local path="$1"
    # Resolve tilde if present
    path="${path/#\~/$HOME}"
    if [ -d "$path" ] || [ -f "$path" ]; then
        echo -e "${BLUE}[CLEANING]${NC} Removing: $path"
        rm -rf "$path"
    fi
}

# 1. Kill Natively processes if running
echo -e "${CYAN}Stopping Natively if running...${NC}"
killall Natively 2>/dev/null || true
killall natively 2>/dev/null || true
sleep 1

# 2. Remove Application Support folders (current and legacy versions)
echo -e "\n${CYAN}1. Clearing Application Support folders...${NC}"
remove_dir "~/Library/Application Support/Natively"
remove_dir "~/Library/Application Support/natively"
remove_dir "~/Library/Application Support/answercue"
remove_dir "~/Library/Application Support/Electron/natively.db"
remove_dir "~/Library/Application Support/Electron/natively-preferences-secure.json"

# 3. Remove Cache directories
echo -e "\n${CYAN}2. Clearing cache files...${NC}"
remove_dir "~/Library/Caches/natively-updater"
remove_dir "~/Library/Caches/natively"
remove_dir "~/Library/Caches/com.electron.meeting-notes"

# 4. Remove Plist Preferences & Saved App States
echo -e "\n${CYAN}3. Clearing application preferences...${NC}"
remove_dir "~/Library/Preferences/com.electron.meeting-notes.plist"
remove_dir "~/Library/Saved Application State/com.electron.meeting-notes.savedState"

# 5. Remove Keychain credentials (safeStorage keys)
echo -e "\n${CYAN}4. Clearing macOS Keychain credentials...${NC}"
delete_keychain_item() {
    local service="$1"
    local account="$2"
    if security find-generic-password -s "$service" -a "$account" >/dev/null 2>&1; then
        echo -e "${BLUE}[CLEANING]${NC} Deleting Keychain entry: $service ($account)"
        security delete-generic-password -s "$service" -a "$account" >/dev/null 2>&1 || true
    fi
}

delete_keychain_item "Electron Safe Storage" "Electron Key"
delete_keychain_item "natively Safe Storage" "natively Key"
delete_keychain_item "Natively Safe Storage" "Natively Key"
delete_keychain_item "Natively Safe Storage" "Electron Key"

# Reset macOS defaults cache so plist removal registers
defaults delete com.electron.meeting-notes >/dev/null 2>&1 || true

echo -e "\n${GREEN}${BOLD}=====================================================${NC}"
echo -e "${GREEN}${BOLD}  CLEANUP COMPLETE!                                  ${NC}"
echo -e "${GREEN}${BOLD}  All caches, databases, models, and credentials    ${NC}"
echo -e "${GREEN}${BOLD}  have been wiped from your Mac.                    ${NC}"
echo -e "${GREEN}${BOLD}=====================================================${NC}"
